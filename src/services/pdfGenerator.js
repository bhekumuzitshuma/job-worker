import PDFDocument from 'pdfkit'
import fs from 'fs'

export async function generateCV(data, outputPath) {
  const doc = new PDFDocument({ margin: 50 })
  doc.pipe(fs.createWriteStream(outputPath))

  // Name
  doc.fontSize(22).text(data.name, { bold: true })
  doc.fontSize(14).text(data.title)
  doc.moveDown()

  // Summary
  doc.fontSize(16).text("Professional Summary")
  doc.fontSize(11).text(data.summary)
  doc.moveDown()

  // Skills
  doc.fontSize(16).text("Skills")
  doc.fontSize(11).text(data.skills.join(', '))
  doc.moveDown()

  // Experience
  doc.fontSize(16).text("Experience")
  data.experience.forEach(job => {
    doc.fontSize(13).text(`${job.role} - ${job.company}`)
    job.points.forEach(p => doc.text(`• ${p}`))
    doc.moveDown()
  })

  // Education
  doc.fontSize(16).text("Education")
  data.education.forEach(edu => {
    doc.text(`${edu.qualification} - ${edu.school}`)
  })

  doc.end()
}
