import PDFDocument from 'pdfkit'
import fs from 'fs'

export async function generateCV(cvJson, outputPath) {
  if (!cvJson || typeof cvJson !== 'object') {
    throw new Error('Invalid CV data provided')
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    const stream = fs.createWriteStream(outputPath)
    doc.pipe(stream)

    const writeLine = (text, opts = {}) => {
      if (!text) return
      doc.fontSize(opts.size || 11).text(text, { continued: false })
    }

    doc.fontSize(22).text(cvJson.full_name || '', { bold: true })
    doc.moveDown(0.2)
    doc.fontSize(12).fillColor('gray').text(cvJson.professional_summary || '')
    doc.moveDown()

    if (Array.isArray(cvJson.skills) && cvJson.skills.length) {
      doc.fontSize(14).fillColor('black').text('Skills')
      doc.moveDown(0.1)
      doc.fontSize(11).text(cvJson.skills.join(', '))
      doc.moveDown()
    }

    if (Array.isArray(cvJson.experience) && cvJson.experience.length) {
      doc.fontSize(14).text('Experience')
      doc.moveDown(0.1)
      cvJson.experience.forEach((exp) => {
        const roleLine = `${exp.role || ''}${exp.company ? ' — ' + exp.company : ''}`
        doc.fontSize(12).text(roleLine)
        const dateRange = `${exp.start_date || ''}${exp.end_date ? ' — ' + exp.end_date : ''}`
        if (dateRange.trim()) doc.fontSize(10).fillColor('gray').text(dateRange)
        doc.fillColor('black')
        if (Array.isArray(exp.responsibilities)) {
          exp.responsibilities.forEach(r => {
            doc.text(`• ${r}`)
          })
        }
        doc.moveDown()
      })
    }

    if (Array.isArray(cvJson.education) && cvJson.education.length) {
      doc.fontSize(14).text('Education')
      doc.moveDown(0.1)
      cvJson.education.forEach(ed => {
        const eduLine = `${ed.qualification || ''}${ed.institution ? ' — ' + ed.institution : ''}${ed.year ? ' (' + ed.year + ')' : ''}`
        doc.fontSize(11).text(eduLine)
      })
      doc.moveDown()
    }

    if (Array.isArray(cvJson.projects) && cvJson.projects.length) {
      doc.fontSize(14).text('Projects')
      doc.moveDown(0.1)
      cvJson.projects.forEach(p => {
        if (typeof p === 'string') doc.fontSize(11).text(`• ${p}`)
        else if (p.title) doc.fontSize(11).text(`• ${p.title} — ${p.description || ''}`)
      })
      doc.moveDown()
    }

    if (Array.isArray(cvJson.certifications) && cvJson.certifications.length) {
      doc.fontSize(14).text('Certifications')
      doc.moveDown(0.1)
      cvJson.certifications.forEach(c => doc.fontSize(11).text(`• ${c}`))
      doc.moveDown()
    }

    doc.end()

    stream.on('finish', () => resolve(outputPath))
    stream.on('error', (err) => reject(err))
  })
}
