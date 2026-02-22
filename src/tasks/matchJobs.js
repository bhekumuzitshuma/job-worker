import { supabase } from '../supabase.js'

export async function matchJobs(task) {
  const { user_id } = task.payload

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user_id)
    .single()

  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')

  for (let job of jobs) {
    const score = profile.data.skills.filter(skill =>
      job.requirements.includes(skill)
    ).length

    if (score > 0) {
      await supabase.from('matches').insert({
        user_id,
        job_id: job.id,
        score
      })
    }
  }
}
