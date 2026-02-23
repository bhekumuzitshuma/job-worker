import { GoogleGenAI } from "@google/genai";
import { supabase } from '../supabase.js'

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY
});

export async function generateApplication(task) {
  const { job_id, user_id } = task.payload

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', job_id)
    .single()

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Write a professional cover letter for this job: ${job.description}`,
  });

  await supabase.from('applications').insert({
    user_id,
    job_id,
    cover_letter: response.text
  })
}
