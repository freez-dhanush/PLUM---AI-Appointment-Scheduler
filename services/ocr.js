import axios from "axios"
import sharp from "sharp"
import FormData from "form-data"

const OCR_SPACE_KEY = "helloworld"

async function preprocessVariants(buffer) {
  // returns array of { name, buffer }
  const variants = []
  // base large PNG
  try {
    const base = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer()
    variants.push({ name: "base", buffer: base })
  } catch (e) {}

  // 1: grayscale + normalize + mild sharpen
  try {
    const b = await sharp(buffer)
      .rotate()
      .grayscale()
      .normalize()
      .sharpen(1)
      .resize({ width: 1800, withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer()
    variants.push({ name: "gray_norm_sharp", buffer: b })
  } catch (e) {}

  // 2: strong threshold (binarize)
  try {
    const b = await sharp(buffer)
      .rotate()
      .grayscale()
      .normalize()
      .threshold(140)   // try 120..160 depending on image
      .resize({ width: 1800, withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer()
    variants.push({ name: "threshold_140", buffer: b })
  } catch (e) {}

  // 3: contrast + sharpen, mild blur to remove texture
  try {
    const b = await sharp(buffer)
      .rotate()
      .modulate({ brightness: 1, saturation: 1.05 })
      .linear(1.1, -10) // increase contrast a bit
      .sharpen(2)
      .resize({ width: 2000, withoutEnlargement: true })
      .png({ quality: 95 })
      .toBuffer()
    variants.push({ name: "contrast_sharp", buffer: b })
  } catch (e) {}

  // 4: lighten background (increase brightness) then threshold
  try {
    const b = await sharp(buffer)
      .rotate()
      .modulate({ brightness: 1.08 })
      .grayscale()
      .threshold(130)
      .resize({ width: 2000, withoutEnlargement: true })
      .png({ quality: 95 })
      .toBuffer()
    variants.push({ name: "bright_thresh", buffer: b })
  } catch (e) {}

  return variants
}

async function ocrSpaceMultipart(buffer, opts = {}) {
  try {
    const form = new FormData()
    form.append("file", buffer, { filename: opts.filename || "upload.png", contentType: "image/png" })
    form.append("language", opts.language || "eng")
    form.append("isOverlayRequired", opts.isOverlayRequired ? "true" : "false")
    if (opts.ocREngine) form.append("OCREngine", String(opts.ocREngine))
    const resp = await axios.post("https://api.ocr.space/parse/image", form, {
      headers: { apikey: OCR_SPACE_KEY, ...form.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: opts.timeout || 120000
    })
    return resp.data
  } catch (err) {
    return { error: err?.response?.data || err.message }
  }
}

function cleanString(s) {
  if (!s) return ""
  let t = s.normalize("NFKD")
  t = t.replace(/[^A-Za-z0-9@:\-\/\s,.]/g, " ")
  t = t.replace(/\s+/g, " ").trim()
  return t
}

function fuzzyRecoverEntities(raw) {
  // attempt to salvage date/time/department from partial noisy OCR
  const s = (raw || "").toLowerCase()
  const cleaned = cleanString(s)
  const tokens = cleaned.split(/\s+/).filter(Boolean)

  // quick time finder: look for am/pm or lone numbers near 'pm' words
  let time_phrase = null
  let date_phrase = null
  let department = null

  const timeMatch = cleaned.match(/(\b\d{1,2}(?::\d{2})?\s*(am|pm)\b)|(\b\d{1,2}:\d{2}\b)|(\b\d{1,2}\s*pm\b)|(\b\d{1,2}\s*am\b)/i)
  if (timeMatch) time_phrase = timeMatch[0].replace(/\s+/g, "")

  // if there's a standalone number and no am/pm, treat as hour (if between 1-12)
  if (!time_phrase) {
    const numMatch = cleaned.match(/\b([1-9]|1[0-9]|2[0-3])\b/)
    if (numMatch) {
      const num = Number(numMatch[0])
      if (num >= 1 && num <= 12) time_phrase = `${num}:00`
      else if (num >= 13 && num <= 23) time_phrase = `${String(num).padStart(2,"0")}:00`
    }
  }

  // date: look for words 'next', 'friday', 'tomorrow', 'today'
  const dateMatch = cleaned.match(/\b(next\s+\w+|this\s+\w+|tomorrow|today|in\s+\d+\s+days|mon|tue|wed|thu|fri|satur|sun)\b/)
  if (dateMatch) date_phrase = dateMatch[0]

  // very rough dept fuzzy: check substrings that look like dentist/dental
  const deptCandidates = ["dentist","dental","cardio","cardiologist","doctor","derma","dermatology","eye","optometrist","physio","physiotherapy"]
  // direct substring
  for (const d of deptCandidates) {
    if (cleaned.indexOf(d) !== -1) { department = d; break }
  }
  // fuzzy: try simple character similarity for small set
  if (!department) {
    for (const d of deptCandidates) {
      for (const t of tokens) {
        // compute simple normalized Levenshtein-ish distance (cheap)
        const a = d, b = t
        const dist = levenshtein(a,b)
        const sim = 1 - dist / Math.max(a.length, b.length)
        if (sim >= 0.45) { department = d; break }
      }
      if (department) break
    }
  }

  return { raw: cleaned, date_phrase, time_phrase, department }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const v0 = new Array(n + 1).fill(0)
  const v1 = new Array(n + 1).fill(0)
  for (let j = 0; j <= n; j++) v0[j] = j
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1
    const ai = a[i]
    for (let j = 0; j < n; j++) {
      const cost = ai === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= n; j++) v0[j] = v1[j]
  }
  return v1[n]
}

export async function runOCR(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return { text: "", confidence: 0 }

  const variants = await preprocessVariants(buffer)
  for (const v of variants) {
    try {
      console.log("Trying variant:", v.name, "size:", v.buffer.length)
      // try OCR.Space with OCREngine=2 which sometimes performs better
      const resp = await ocrSpaceMultipart(v.buffer, { timeout: 90000, ocREngine: 2, isOverlayRequired: false })
      if (resp?.ParsedResults && resp.ParsedResults[0] && resp.ParsedResults[0].ParsedText) {
        const txt = String(resp.ParsedResults[0].ParsedText || "").trim()
        if (txt) {
          console.log("OCR.Space success on variant", v.name, "text length", txt.length)
          return { text: txt, confidence: 0.78 }
        }
      } else {
        console.log("OCR.Space empty on variant", v.name, " – FileParseExitCode:", resp?.ParsedResults?.[0]?.FileParseExitCode, "Error:", resp?.ErrorMessage || "")
      }
    } catch (err) {
      console.warn("OCR.Space call error for variant", v.name, err)
    }
  }

  // none of the variants gave text — attempt fuzzy recover from the raw original (fast)
  const recovered = fuzzyRecoverEntities(buffer.toString("utf8") || "")
  // If buffer text is empty, try simple OCR.Space without preprocessing as last resort:
  try {
    const rawResp = await ocrSpaceMultipart(buffer, { timeout: 90000, ocREngine: 2 })
    const parsed = rawResp?.ParsedResults?.[0]?.ParsedText || ""
    if (parsed && parsed.trim()) {
      return { text: parsed.trim(), confidence: 0.7 }
    }
  } catch (e) {}

  // Return the fuzzy recovered partial info in a textual form for debugging, so extractor can try fuzzy logic
  const fallbackText = recovered.raw || ""
  return { text: fallbackText, confidence: 0.25 }
}
