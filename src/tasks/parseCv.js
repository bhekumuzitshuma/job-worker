import fs from "fs";
import { PDFParse } from "pdf-parse";
import { supabase } from "../supabase.js";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

export async function parseCv(task) {
  console.log(`🚀 Processing CV ID: ${task.payload.cv_id}`);

  const { cv_id } = task.payload;

  // Fetch CV record from cvs table
  const { data: cvRecord, error: cvError } = await supabase
    .from("cvs")
    .select("*")
    .eq("id", cv_id)
    .single();

  if (cvError || !cvRecord) {
    throw new Error(`CV record not found: ${cvError?.message}`);
  }

  const { user_id, file_path } = cvRecord;
  let extractedText = cvRecord.extracted_text;

  // If text hasn't been extracted yet, extract it from the file
  if (!extractedText) {
    console.log("📄 Extracting text from PDF...");

    // Get signed URL from Supabase storage
    const { data, error: signedUrlError } = await supabase.storage
      .from("cvs")
      .createSignedUrl(file_path, 60 * 60);

    if (signedUrlError || !data) {
      throw new Error(`Failed to get signed URL: ${signedUrlError?.message}`);
    }

    // Fetch the PDF from the signed URL
    const response = await fetch(data.signedUrl);
    const buffer = await response.arrayBuffer();

    // Create PDF parser instance with file buffer
    const parser = new PDFParse({
      data: buffer,
    });

    const result = await parser.getText();
    extractedText = result.text;

    // Update cvs table with extracted text
    await supabase
      .from("cvs")
      .update({ extracted_text: extractedText })
      .eq("id", cv_id);

    console.log(`✅ Text extracted: ${extractedText.length} characters`);
  }

  // Use Gemini to extract structured profile information
  console.log("🤖 Extracting profile with Gemini...");
  const profile = await extractProfileWithGemini(extractedText);

  // Check if profile already exists for this user
  console.log("🔍 Checking for existing profile...");
  const { data: existingProfile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to check existing profile: ${fetchError.message}`);
  }

  let result;
  if (existingProfile) {
    // Update existing profile
    console.log("🔄 Updating existing profile...");
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: profile.full_name,
        primary_role: profile.primary_role,
        experience_level: profile.experience_level,
        skills: profile.skills,
        summary: profile.summary,
        qualifications: profile.qualifications,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user_id)
      .select();

    if (updateError) {
      throw new Error(`Failed to update profile: ${updateError.message}`);
    }
    result = data;
    console.log(`✅ Profile updated for ${profile.full_name || "user"}`);
  } else {
    // Create new profile
    console.log("🆕 Creating new profile...");
    const { data, error: insertError } = await supabase
      .from("profiles")
      .insert({
        user_id,
        full_name: profile.full_name,
        primary_role: profile.primary_role,
        experience_level: profile.experience_level,
        skills: profile.skills,
        summary: profile.summary,
        qualifications: profile.qualifications,
      })
      .select();

    if (insertError) {
      throw new Error(`Failed to insert profile: ${insertError.message}`);
    }
    result = data;
    console.log(`✅ Profile created for ${profile.full_name || "user"}`);
  }

  return { profile, result };
}

async function extractProfileWithGemini(cvText) {
  const prompt = `
You are an expert CV/resume parser. Extract the following information from the CV text provided below.

Return a valid JSON object with exactly these fields:
{
  "full_name": "The person's full name as a string",
  "primary_role": "Their current or most recent job title/role",
  "experience_level": "One of: 'entry', 'junior', 'mid', 'senior', 'lead'",
  "skills": ["Array of all relevant skills mentioned"],
  "summary": "A 2-3 sentence professional summary",
  "qualifications": [
    {
      "type": "education or certification",
      "description": "Full description of the qualification",
      "institution": "School/university/organization name",
      "degree": "Degree name or certification title"
    }
  ]
}

CRITICAL GUIDELINES:
- This CV could be from ANY field (tech, medicine, education, arts, business, trades)
- For experience_level, use: entry (<2y), junior (2-4y), mid (5-7y), senior (8+y), lead (10+y with leadership)
- Extract ALL skills mentioned, not just technical ones
- If information is ambiguous, make your best educated guess
- Never make up information - use null if truly not found

CV TEXT:
${cvText}

Return ONLY the JSON object, no additional text or markdown formatting.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    });

    // Parse the JSON response
    const text = response.text;
    const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim();
    const profile = JSON.parse(cleanedText);

    // Validate and ensure proper structure
    return {
      full_name: profile.full_name || "Unknown",
      primary_role: profile.primary_role || "Not specified",
      experience_level: profile.experience_level || "entry",
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      summary: profile.summary || "No summary available",
      qualifications: Array.isArray(profile.qualifications)
        ? profile.qualifications
        : [],
    };
  } catch (error) {
    console.error("❌ Gemini extraction failed:", error.message);
    throw new Error(`Failed to extract profile with Gemini: ${error.message}`);
  }
}