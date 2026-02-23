import { Resend } from 'resend'
import fs from 'fs'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendApplication({
  to,
  userEmail,
  userName,
  coverLetter,
  cvPath,
  subject
}) {
  if (!to) throw new Error('No recipient email provided')

  const file = fs.readFileSync(cvPath)

  const emailSubject = subject || `Application - ${userName}`

  try {
    const res = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Job Automation <onboarding@resend.dev>',
      to: to,
      subject: emailSubject,
      reply_to: userEmail,
      text: coverLetter,
      attachments: [
        {
          filename: `${userName}-CV.pdf`,
          content: file
        }
      ]
    })

    return res
  } catch (err) {
    console.error('Failed to send application email:', err.message)
    throw err
  }
}
