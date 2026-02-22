import { supabase } from './supabase.js'
import { handleTask } from './taskHandler.js'

export function startPolling() {
  setInterval(async () => {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'pending')
      .limit(1)

    if (tasks && tasks.length > 0) {
      const task = tasks[0]

      await supabase
        .from('tasks')
        .update({ status: 'processing' })
        .eq('id', task.id)

      await handleTask(task)
    }
  }, 5000)
}
