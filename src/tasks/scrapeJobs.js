import puppeteer from "puppeteer";
import { supabase } from "../supabase.js";

// Its updating a certain row instead of adding new ones.

export async function scrapeJobs(options = { maxPages: 10 }) {
  console.log("Starting job scraping from vacancymail.co.zw...");
  const scrapedJobs = [];
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    let currentPage = 1;
    let hasNextPage = true;

    // First pass: Collect all job URLs from all pages
    const jobUrls = [];

    while (hasNextPage && currentPage <= options.maxPages) {
      const url =
        currentPage === 1
          ? "https://vacancymail.co.zw/jobs/"
          : `https://vacancymail.co.zw/jobs/?page=${currentPage}`;

      console.log(`Scanning page ${currentPage} for job URLs: ${url}`);

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      // Wait for job listings to load
      await page.waitForSelector(".job-listing", { timeout: 10000 });

      // Extract job URLs from current page
      const pageUrls = await page.evaluate(() => {
        const jobElements = document.querySelectorAll(".job-listing");
        const urls = [];

        jobElements.forEach((element) => {
          const link = element.getAttribute("href");
          if (link) {
            // Handle relative URLs like /jobs/finance-manager-66579/
            const fullUrl = link.startsWith("http")
              ? link
              : `https://vacancymail.co.zw${link}`;
            urls.push(fullUrl);
          }
        });

        return urls;
      });

      console.log(`Found ${pageUrls.length} job URLs on page ${currentPage}`);
      jobUrls.push(...pageUrls);

      // Check if there's a next page by looking for the right arrow link that's not disabled
      hasNextPage = await page.evaluate(() => {
        const nextButtons = document.querySelectorAll(".pagination-arrow a");
        for (let btn of nextButtons) {
          if (
            btn.querySelector(".icon-material-outline-keyboard-arrow-right")
          ) {
            // Check if it's not disabled and has an href
            return (
              !btn.hasAttribute("disabled") &&
              !btn.classList.contains("disabled") &&
              btn.getAttribute("href") !== "#"
            );
          }
        }
        return false;
      });

      currentPage++;

      // Small delay between pages
      if (hasNextPage && currentPage <= options.maxPages) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`Total job URLs found: ${jobUrls.length}`);
    console.log("Sample URL:", jobUrls[0] || "No URLs found");

    // Second pass: Visit each job URL and extract details
    for (let i = 0; i < jobUrls.length; i++) {
      const jobUrl = jobUrls[i];

      try {
        console.log(`\n[${i + 1}/${jobUrls.length}] Scraping job: ${jobUrl}`);

        await page.goto(jobUrl, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait for content to load - look for the main content area
        await page
          .waitForSelector(".col-xl-8.col-lg-8.content-right-offset", {
            timeout: 10000,
          })
          .catch(() => console.log("Selector timeout, continuing anyway..."));

        // Extract all job details from the detail page using the exact structure
        const jobDetails = await page.evaluate(() => {
          // Helper function to clean text
          const cleanText = (text) =>
            text ? text.replace(/\s+/g, " ").trim() : "";

          // Get title from the job listing title in the detail page
          const titleEl = document.querySelector(".job-listing-title");
          let title = titleEl ? cleanText(titleEl.textContent) : "";

          // If title not found, try to extract from URL or h1
          if (!title) {
            const h1El = document.querySelector("h1.page-title");
            title = h1El ? cleanText(h1El.textContent) : "";
          }

          // Get company name
          let company = "";

          // Try to get from job-listing-company
          const companyEl = document.querySelector(".job-listing-company");
          if (companyEl) {
            company = cleanText(companyEl.textContent);
          }

          // If not found, try logo alt (but filter out "Vacancy Mail")
          if (!company || company === "Vacancy Mail") {
            const logoImg = document.querySelector(
              ".job-listing-company-logo img",
            );
            if (logoImg) {
              const alt = logoImg.getAttribute("alt");
              if (alt && alt !== "Vacancy Mail" && alt !== "Vacancy Mail") {
                company = alt;
              }
            }
          }

          // Get location from the listing at the top (from the original listing structure)
          let location = "";
          const locationElements = document.querySelectorAll(
            ".job-listing-footer ul li",
          );
          locationElements.forEach((el) => {
            if (el.querySelector(".icon-material-outline-location-on")) {
              location = cleanText(el.textContent);
            }
          });

          // If location not found in footer, try the detail page
          if (!location) {
            const detailLocation = document.querySelector(
              ".single-page-section p:first-child",
            );
            if (
              detailLocation &&
              detailLocation.textContent.includes("Location:")
            ) {
              location = cleanText(
                detailLocation.textContent.replace("Location:", ""),
              );
            }
          }

          // Initialize description and requirements
          let description = "";
          let requirements = "";
          let apply_email = "";

          // Get all single-page sections (these contain the job details)
          const sections = document.querySelectorAll(".single-page-section");

          sections.forEach((section) => {
            const heading = section.querySelector("h3");
            if (!heading) return;

            const headingText = heading.textContent.toLowerCase().trim();

            // Get all paragraphs and lists in this section
            const paragraphs = section.querySelectorAll("p");
            const lists = section.querySelectorAll("ul");

            let sectionContent = "";

            paragraphs.forEach((p) => {
              if (p.textContent.trim()) {
                sectionContent += p.textContent.trim() + "\n";
              }
            });

            lists.forEach((ul) => {
              const items = ul.querySelectorAll("li");
              items.forEach((li) => {
                if (li.textContent.trim()) {
                  sectionContent += "• " + li.textContent.trim() + "\n";
                }
              });
            });

            if (sectionContent) {
              // Categorize based on heading
              if (headingText.includes("job description")) {
                description += "Job Description:\n" + sectionContent + "\n\n";
              } else if (
                headingText.includes("duties") ||
                headingText.includes("responsibilities")
              ) {
                description +=
                  "Duties and Responsibilities:\n" + sectionContent + "\n\n";
              } else if (
                headingText.includes("qualifications") ||
                headingText.includes("experience")
              ) {
                requirements += sectionContent;
              } else if (headingText.includes("how to apply")) {
                description += "How to Apply:\n" + sectionContent + "\n\n";

                // Extract email from How to Apply section
                const emailMatch = sectionContent.match(
                  /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/,
                );
                if (emailMatch) {
                  apply_email = emailMatch[1];
                }
              }
            }
          });

          // If we couldn't categorize, just combine all sections
          if (!description && !requirements) {
            sections.forEach((section) => {
              const content = section.textContent || "";
              if (content) {
                description += cleanText(content) + "\n\n";
              }
            });
          }

          // If still no description, get the main content
          if (!description) {
            const mainContent = document.querySelector(
              ".col-xl-8.col-lg-8.content-right-offset",
            );
            if (mainContent) {
              description = cleanText(mainContent.textContent);
            }
          }

          // Extract email from mailto links (most reliable)
          if (!apply_email) {
            const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
            if (mailtoLinks.length > 0) {
              apply_email = mailtoLinks[0]
                .getAttribute("href")
                .replace("mailto:", "")
                .split("?")[0];
            }
          }

          // If no mailto link, try to find email in text
          if (!apply_email) {
            const emailRegex =
              /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
            const bodyText = document.body.textContent || "";
            const emailMatches = bodyText.match(emailRegex);
            if (emailMatches && emailMatches.length > 0) {
              // Filter out common non-application emails
              const filteredEmails = emailMatches.filter(
                (email) =>
                  !email.includes("example.com") &&
                  !email.includes("domain.com") &&
                  !email.includes("@vacancymail.co.zw") &&
                  !email.includes("@google.com") &&
                  !email.includes("@dynatondata.com"),
              );
              if (filteredEmails.length > 0) {
                apply_email = filteredEmails[0];
              }
            }
          }

          // Extract website links (excluding vacancymail and ad links)
          let website = "";
          const allLinks = document.querySelectorAll('a[href^="http"]');
          for (const link of allLinks) {
            const href = link.getAttribute("href");
            if (
              href &&
              !href.includes("vacancymail") &&
              !href.includes("google") &&
              !href.includes("dynatondata") &&
              !href.includes("doubleclick") &&
              !href.includes("mailto:")
            ) {
              website = href;
              break;
            }
          }

          // Use the current URL as fallback for website
          const currentUrl = window.location.href;

          return {
            title: title || "Untitled Position",
            company: company || "Not Specified",
            location: location || "Zimbabwe",
            description: description || "",
            requirements: requirements || "",
            apply_email: apply_email || "",
            website: website || currentUrl, // Store the job URL in website field
            url: currentUrl,
          };
        });

        // Add the scraped job to our collection
        scrapedJobs.push(jobDetails);

        // Insert into Supabase
        try {
          // Check if job with same website (URL) exists
          const { data: existingJob } = await supabase
            .from("jobs")
            .select("id")
            .eq("website", jobDetails.website)
            .maybeSingle();

          if (existingJob) {
            // Update existing job
            const { error } = await supabase
              .from("jobs")
              .update({
                title: jobDetails.title,
                company: jobDetails.company,
                location: jobDetails.location,
                description: jobDetails.description,
                requirements: jobDetails.requirements,
                apply_email: jobDetails.apply_email,
                website: jobDetails.website, // Keep the URL here
              })
              .eq("id", existingJob.id);

            if (error) throw error;
            console.log(`✓ Updated: ${jobDetails.title}`);
          } else {
            // Insert new job
            const { error } = await supabase.from("jobs").insert({
              title: jobDetails.title,
              company: jobDetails.company,
              location: jobDetails.location,
              description: jobDetails.description,
              requirements: jobDetails.requirements,
              apply_email: jobDetails.apply_email,
              website: jobDetails.website, // Store the URL here
            });

            if (error) throw error;
            console.log(`✓ Inserted: ${jobDetails.title}`);
          }
        } catch (dbError) {
          console.error(
            `✗ Database error for ${jobDetails.title}:`,
            dbError.message,
          );
        }

        // Random delay between 2-4 seconds to be respectful
        const delay = 2000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        console.error(`✗ Failed to scrape job at ${jobUrl}:`, error.message);
      }
    }

    await browser.close();

    console.log("\n=================================");
    console.log("✅ Job scraping completed successfully");
    console.log(`Total jobs scraped: ${scrapedJobs.length}`);
    console.log(`Pages scanned: ${currentPage - 1}`);
    console.log("=================================");

    return {
      success: true,
      totalJobs: scrapedJobs.length,
      jobUrls: jobUrls.length,
      pagesScraped: currentPage - 1,
    };
  } catch (error) {
    console.error("Scraping error:", error);
    await browser.close();
    return { success: false, error: error.message };
  }
}

// For running as a scheduled daily task
export async function runDailyScrape() {
  console.log("📅 Running daily job scrape:", new Date().toISOString());

  const startTime = Date.now();
  const result = await scrapeJobs({ maxPages: 10 }); // Adjust maxPages as needed

  const duration = (Date.now() - startTime) / 1000;

  // Log the result to Supabase for monitoring
  try {
    await supabase.from("scrape_logs").insert({
      task: "job_scraper",
      status: result.success ? "success" : "failed",
      jobs_found: result.totalJobs || 0,
      pages_scraped: result.pagesScraped || 0,
      duration_seconds: duration,
      error: result.error || null,
      ran_at: new Date().toISOString(),
    });
  } catch (logError) {
    console.error("Failed to log scrape result:", logError);
  }

  console.log(`Scrape completed in ${duration} seconds`);
  return result;
}

export default scrapeJobs;
