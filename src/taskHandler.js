import { parseCv } from './tasks/parseCv.js'
import { scrapeJobs } from './tasks/scrapeJobs.js'
import { matchJobs } from './tasks/matchJobs.js'
import { generateApplication } from './tasks/generateApplication.js'
import { sendApplication } from './tasks/sendApplication.js'
import { supabase } from './supabase.js'

export async function handleTask(task) {
  try {
    switch (task.type) {
      case 'parse_cv':
        await parseCv(task)
        break

      case 'scrape_jobs':
        await scrapeJobs(task)
        break

      case 'match_jobs':
        await matchJobs(task)
        break

      case 'generate_application':
        await generateApplication(task)
        break

      case 'send_application':
        await sendApplication(task)
        break
    }

    await supabase
      .from('tasks')
      .update({ status: 'completed' })
      .eq('id', task.id)

  } catch (error) {
    console.error(error)

    await supabase
      .from('tasks')
      .update({ status: 'failed', error: error.message })
      .eq('id', task.id)
  }
}
