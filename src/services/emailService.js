import { Resend } from 'resend'
import fs from 'fs'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendApplication({
  to,
  userEmail,
  userName,
  coverLetter,
  cvPath
}) {

  const file = fs.readFileSync(cvPath)

  await resend.emails.send({
    from: 'Job Automation <onboarding@resend.dev>',
    to: to,
    subject: `Job Application - ${userName}`,
    reply_to: userEmail,   // VERY IMPORTANT
    text: coverLetter,
    attachments: [
      {
        filename: `${userName}-CV.pdf`,
        content: file
      }
    ]
  })
}
