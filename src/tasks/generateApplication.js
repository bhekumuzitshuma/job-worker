import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { supabase } from '../supabase.js'
import { GoogleGenAI } from '@google/genai'
import { generateCV } from '../services/pdfGenerator.js'
import { sendApplication } from '../services/emailService.js'

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function validateCvJson(obj) {
  const required = ['full_name','professional_summary','skills','experience','education','projects','certifications']
  if (!obj || typeof obj !== 'object') return false
  return required.every(k => Object.prototype.hasOwnProperty.call(obj, k))
}

export async function generateApplication(task) {
  const { user_id } = task.payload
  console.log(`🧩 generate_application for user ${user_id}`)

  // Defaults
  let applicationRecord = null
  let applicationId = null
  let pdfPath = null

  try {
    // 1. Fetch user settings
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('min_match_score, application_email, email_signature')
      .eq('user_id', user_id)
      .single()

    if (settingsError) {
      throw new Error(`Failed to load user settings: ${settingsError.message}`)
    }

    const minMatch = settings?.min_match_score ?? 70
    const replyEmail = settings?.application_email
    const emailSignature = settings?.email_signature || ''

    // 2. Ensure we don't apply twice: fetch existing applied job ids
    const { data: existingApplications } = await supabase
      .from('applications')
      .select('job_id')
      .eq('user_id', user_id)

    const appliedJobIds = (existingApplications || []).map(r => r.job_id)

    // 3. Fetch candidate matches above threshold
    const { data: matches } = await supabase
      .from('matches')
      .select('*')
      .eq('user_id', user_id)
      .gte('match_score', minMatch)
      .order('match_score', { ascending: false })

    if (!matches || matches.length === 0) {
      console.log('No matches meet user minimum match score')
      return { success: true, reason: 'no_match_meeting_threshold' }
    }

    // pick highest scoring job not yet applied to
    let chosenMatch = null
    for (const m of matches) {
      if (!appliedJobIds.includes(m.job_id)) {
        chosenMatch = m
        break
      }
    }

    if (!chosenMatch) {
      console.log('No unmatched jobs found (user already applied)')
      return { success: true, reason: 'no_unapplied_job_found' }
    }

    const jobId = chosenMatch.job_id

    // 4. Load job
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error(`Failed to fetch job ${jobId}: ${jobError?.message}`)
    }

    const jobInfo = {
      title: job.title,
      company: job.company,
      location: job.location,
      description: stripHtml(job.description || ''),
      requirements: Array.isArray(job.requirements) ? job.requirements : (typeof job.requirements === 'string' ? job.requirements : ''),
      responsibilities: job.responsibilities || [],
      employer_email: job.employer_email || job.contact_email || job.contact || job.employer_contact || null,
      apply_email: job.apply_email || null
    }
    // Prefer the standardized `apply_email` field in jobs table
    const recipientEmail = jobInfo.apply_email || jobInfo.employer_email
    if (!recipientEmail) {
      throw new Error('Employer email not found on job record')
    }

    // 5. Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (profileError || !profile) {
      throw new Error(`Profile not found for user ${user_id}: ${profileError?.message}`)
    }

    // 6. Generate CV JSON with Gemini (strict JSON-only, retry on invalid output)
    console.log('🧠 Generating tailored CV JSON with Gemini (strict JSON only)...')

    const schemaExample = {
      full_name: 'Full Name',
      professional_summary: 'Two-three sentence summary',
      skills: ['skill1', 'skill2'],
      experience: [
        { company: 'Org', role: 'Role', start_date: '', end_date: '', responsibilities: ['...'] }
      ],
      education: [ { institution: '', qualification: '', year: '' } ],
      projects: [],
      certifications: []
    }

    const basePrompt = `You are an expert resume writer. Given the user's profile and the job requirements, produce a STRICTLY VALID JSON object that matches this structure exactly (keys and types):\n${JSON.stringify(schemaExample, null, 2)}\n\nUser profile (JSON): ${JSON.stringify(profile)}\n\nJob information: ${jobInfo.title} at ${jobInfo.company} - ${jobInfo.description}\nRequirements: ${Array.isArray(jobInfo.requirements) ? jobInfo.requirements.join(', ') : jobInfo.requirements}\n\nIMPORTANT: Return ONLY the JSON object, with no explanation, no surrounding markdown, and no code fences. The output must be parseable by a JSON.parse call.`

    let cvJson = null
    let lastError = null
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prompt = attempt === 1 ? basePrompt : `Previous response was not valid JSON. Reply ONLY with the JSON object matching this structure exactly: ${JSON.stringify(schemaExample)}. No other text.`

      const resp = await genai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { temperature: 0.0, maxOutputTokens: 1600 }
      })

      let cvText = (resp.text || '').replace(/```json\n?|```/g, '').trim()

      try {
        const parsed = JSON.parse(cvText)
        if (!validateCvJson(parsed)) {
          lastError = new Error('Generated CV JSON did not match expected schema')
          console.warn(`Attempt ${attempt}: schema validation failed`)
          continue
        }
        cvJson = parsed
        break
      } catch (err) {
        lastError = err
        console.warn(`Attempt ${attempt}: failed to parse JSON from Gemini response`)
        // continue to retry
      }
    }

    if (!cvJson) {
      throw new Error(`Gemini returned invalid JSON for CV: ${lastError?.message || 'no valid response'}`)
    }

    // 7. Generate PDF locally
    console.log('📄 Generating CV PDF...')
    const tmpDir = os.tmpdir()
    const pdfName = `${user_id}-${jobId}-${randomUUID()}.pdf`
    pdfPath = path.join(tmpDir, pdfName)

    // Map cvJson to pdfGenerator expected shape
    const pdfData = {
      name: cvJson.full_name,
      title: profile.primary_role || '',
      summary: cvJson.professional_summary,
      skills: Array.isArray(cvJson.skills) ? cvJson.skills : [],
      experience: (cvJson.experience || []).map(e => ({ role: e.role || '', company: e.company || '', points: e.responsibilities || [] })),
      education: (cvJson.education || []).map(ed => ({ qualification: ed.qualification || '', school: ed.institution || '' }))
    }

    await generateCV(pdfData, pdfPath)

    // 8. Upload CV to Supabase storage and create cvs record
    const filePath = `${user_id}/${randomUUID()}.pdf`
    const fileBuffer = fs.readFileSync(pdfPath)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('cvs')
      .upload(filePath, fileBuffer, { upsert: false })

    if (uploadError) {
      throw new Error(`Failed to upload CV to storage: ${uploadError.message}`)
    }

    const { data: cvRecordData, error: cvInsertError } = await supabase
      .from('cvs')
      .insert({ user_id, file_path: filePath })
      .select()

    if (cvInsertError) {
      throw new Error(`Failed to create cvs record: ${cvInsertError.message}`)
    }

    const cvId = cvRecordData[0].id

    // 9. Generate cover letter
    console.log('✍️  Generating cover letter...')
    const coverPrompt = `
Write a professional, tailored cover letter for the role of ${jobInfo.title} at ${jobInfo.company}.
Job description: ${jobInfo.description}
User profile: ${JSON.stringify(profile)}
Use the tone: professional, concise, confident. Keep it to 3-5 short paragraphs.
Return only plain text for the cover letter (no JSON, no markdown).
`

    const coverResp = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: coverPrompt,
      config: { temperature: 0.3, maxOutputTokens: 800 }
    })

    let coverLetter = (coverResp.text || '').trim()
    if (emailSignature) coverLetter = `${coverLetter}\n\n${emailSignature}`

    // 10. Idempotency check again
    const { data: existingAlready } = await supabase
      .from('applications')
      .select('id')
      .eq('user_id', user_id)
      .eq('job_id', jobId)
      .maybeSingle()

    if (existingAlready) {
      console.log('User already applied to this job (race condition)')
      return { success: true, reason: 'already_applied', job_id: jobId }
    }

    // 11. Insert application record with pending status
    const { data: appData, error: appInsertError } = await supabase
      .from('applications')
      .insert({ user_id, cv_id: cvId, job_id: jobId, cover_letter: coverLetter, status: 'pending' })
      .select()

    if (appInsertError) {
      throw new Error(`Failed to insert application record: ${appInsertError.message}`)
    }

    applicationId = appData[0].id

    // 12. Send the email
    console.log('📧 Sending application email...')
    const subject = `Application for ${jobInfo.title} – ${cvJson.full_name}`

    await sendApplication({
      to: recipientEmail,
      userEmail: replyEmail,
      userName: cvJson.full_name,
      coverLetter,
      cvPath: pdfPath,
      subject
    })

    // 13. Update application status to success
    await supabase.from('applications').update({ status: 'success', applied_at: new Date().toISOString() }).eq('id', applicationId)

    console.log('✅ Application sent successfully')
    return { success: true, job_id: jobId, application_id: applicationId }

  } catch (error) {
    console.error('❌ generate_application error:', error.message)

    try {
      // Attempt to record failed application if we have applicationId
      if (applicationId) {
        await supabase.from('applications').update({ status: 'failed' }).eq('id', applicationId)
      }
    } catch (err) {
      console.error('Failed to mark application failed:', err.message)
    }

    return { success: false, reason: error.message }
  } finally {
    // Cleanup temp PDF if it exists
    try {
      if (pdfPath && fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath)
      }
    } catch (err) {
      console.error('Failed to remove temp PDF:', err.message)
    }
  }
}
