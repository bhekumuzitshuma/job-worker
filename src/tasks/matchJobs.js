import { supabase } from '../supabase.js'

export async function matchJobs(task) {
  console.log(`🔍 Matching jobs for user: ${task.payload.user_id}`)
  
  const { user_id } = task.payload

  // Fetch user's profile with skills
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user_id)
    .single()

  if (profileError || !profile) {
    throw new Error(`Profile not found for user ${user_id}: ${profileError?.message}`)
  }

  console.log(`👤 Found profile for ${profile.full_name}`)

  const userSkills = profile.skills || []
  console.log(`🛠️  User skills: ${userSkills.join(', ')}`)

  // Fetch all available jobs
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('*')

  if (jobsError || !jobs) {
    throw new Error(`Failed to fetch jobs: ${jobsError?.message}`)
  }

  console.log(`💼 Found ${jobs.length} available jobs`)

  let matchCount = 0

  // Match each job with user profile
  for (const job of jobs) {
    // Parse requirements if it's a string, otherwise assume it's an array
    let jobRequirements = []
    if (typeof job.requirements === 'string') {
      // Split by common delimiters and clean up
      jobRequirements = job.requirements
        .toLowerCase()
        .split(/[,;]|\s+and\s+/)
        .map(req => req.trim())
        .filter(req => req.length > 0)
    } else if (Array.isArray(job.requirements)) {
      jobRequirements = job.requirements.map(req => 
        typeof req === 'string' ? req.toLowerCase() : String(req)
      )
    }

    // Calculate match score based on skill overlap
    const matchedSkills = userSkills.filter(skill => {
      const skillLower = skill.toLowerCase()
      return jobRequirements.some(req => 
        req.includes(skillLower) || skillLower.includes(req)
      )
    })

    // Calculate match score as percentage (0-100)
    const matchScore = jobRequirements.length > 0
      ? Math.round((matchedSkills.length / jobRequirements.length) * 100)
      : 0

    // Only create matches for jobs with at least some overlap
    if (matchScore > 0) {
      const reason = `Matched ${matchedSkills.length} skill(s): ${matchedSkills.join(', ')}`

      const { error: insertError } = await supabase
        .from('matches')
        .insert({
          user_id,
          job_id: job.id,
          match_score: matchScore,
          reason,
          status: 'suggested',
        })

      if (insertError) {
        console.error(`⚠️  Failed to insert match for job ${job.id}:`, insertError.message)
      } else {
        matchCount++
        console.log(`✅ Created match for "${job.title}" at ${job.company} (score: ${matchScore})`)
      }
    }
  }

  console.log(`🎯 Matching complete: ${matchCount} jobs matched`)

  // Create generate_application task
  console.log("📝 Creating generate_application task...")
  const { data: taskData, error: taskError } = await supabase
    .from("tasks")
    .insert({
      type: "generate_application",
      payload: { user_id },
      status: "pending",
    })
    .select()

  if (taskError) {
    throw new Error(`Failed to create generate_application task: ${taskError.message}`)
  }

  console.log(`✅ generate_application task created with ID: ${taskData[0].id}`)
  
  return { user_id, jobsProcessed: jobs.length, matchesCreated: matchCount }
}
