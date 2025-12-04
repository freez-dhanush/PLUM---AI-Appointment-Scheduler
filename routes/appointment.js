import express from 'express'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import dotenv from 'dotenv'
import { runOCR } from '../services/ocr.js'
import { extractEntities } from '../services/llm.js'
import { computeDateFromPhrase, parseTimePhraseTo24, isValidISODate } from '../services/normalize.js'
import { utcToZonedISODate } from '../utils/helpers.js'
import { fallbackExtract } from '../services/fallbackExtractor.js'

dotenv.config()
const router = express.Router()
const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`
    cb(null, name)
  }
})

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff']
  if (allowed.includes(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid file type. Only JPG, PNG, WEBP, TIFF allowed.'), false)
}

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter })

router.post('/parse-appointment', upload.single('image'), async (req, res) => {
  try {
    console.log('--- new /parse-appointment request ---')
    console.log('req.file exists?', !!req.file)
    if (req.file) {
      console.log('req.file.originalname =', req.file.originalname)
      console.log('req.file.mimetype =', req.file.mimetype)
      console.log('req.file.size =', req.file.size)
    } else {
      console.log('req.body keys =', Object.keys(req.body || {}))
    }

    let rawText = null
    let ocrConfidence = 1.0
    let tempFilePath = null

    if (req.file) {
      tempFilePath = req.file.path
      const buffer = await fs.promises.readFile(tempFilePath)
      console.log('buffer present?', !!buffer, 'buffer length=', buffer ? buffer.length : 0)
      const ocr = await runOCR(buffer)
      console.log('OCR result:', ocr)
      rawText = ocr.text
      ocrConfidence = ocr.confidence
      try { await fs.promises.unlink(tempFilePath) } catch (e) {}
    } else if (req.body && req.body.text) {
      rawText = req.body.text
      ocrConfidence = 1.0
    } else {
      return res.status(400).json({ status: 'error', message: 'Provide text or an image file (field name: image)' })
    }

    const todayISO = utcToZonedISODate(new Date(), process.env.TIMEZONE || 'Asia/Kolkata')
    let llmResult = null
    try {
      llmResult = await extractEntities(rawText, todayISO, process.env.TIMEZONE || 'Asia/Kolkata')
    } catch (e) {
      llmResult = null
    }

    if (!llmResult || llmResult.status === 'needs_clarification') {
      const fb = fallbackExtract(rawText)
      llmResult = { status: fb.status || 'needs_clarification', entities: fb.entities || {}, entities_confidence: fb.entities_confidence ?? 0, normalized: fb.normalized || {} }
    }

    if (!llmResult) return res.json({ status: 'needs_clarification', message: 'LLM failed to extract entities' })
    if (llmResult.status === 'needs_clarification' && (!llmResult.entities || Object.keys(llmResult.entities).length === 0)) return res.json(llmResult)

    let datePhrase = llmResult.entities?.date_phrase || null
    let timePhrase = llmResult.entities?.time_phrase || null
    let department = llmResult.entities?.department || null
    const entitiesConfidence = llmResult.entities_confidence ?? 0

    if (!datePhrase || !timePhrase || !department) {
      const fb = fallbackExtract(rawText)
      if (!department && fb.entities?.department) department = fb.entities.department
      if (!datePhrase && fb.entities?.date_phrase) datePhrase = fb.entities.date_phrase
      if (!timePhrase && fb.entities?.time_phrase) timePhrase = fb.entities.time_phrase
    }

    if (!datePhrase && rawText) {
      const wk = rawText.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
      if (wk) {
        const prefix = rawText.toLowerCase().match(/\b(next|this|tomorrow|today)\b/)
        datePhrase = prefix ? `${prefix[0]} ${wk[0]}` : `next ${wk[0]}`
      }
    }

    if (!department && rawText) {
      const cleaned = (rawText || '').toLowerCase()
      if (cleaned.includes('dent') || cleaned.includes('tooth') || cleaned.includes('dental')) department = 'dentist'
    }

    const baseDate = new Date()
    let normalizedDate = computeDateFromPhrase(baseDate, datePhrase, process.env.TIMEZONE || 'Asia/Kolkata')
    let normalizedTime = parseTimePhraseTo24(timePhrase)

    if (!normalizedDate && llmResult.normalized?.date) {
      if (isValidISODate(llmResult.normalized.date)) normalizedDate = llmResult.normalized.date
    }
    if (!normalizedTime && llmResult.normalized?.time) normalizedTime = llmResult.normalized.time

    const normalizationConfidence = Math.min(1.0, (0.4 * ocrConfidence) + (0.4 * entitiesConfidence) + 0.2)

    if (!normalizedDate || !normalizedTime || !department) {
      return res.json({
        status: 'needs_clarification',
        message: 'Ambiguous date/time or department',
        details: { raw_text: rawText || '', entities: llmResult.entities || {}, normalizedDate, normalizedTime }
      })
    }

    const appointment = { department: department[0].toUpperCase() + department.slice(1), date: normalizedDate, time: normalizedTime, tz: process.env.TIMEZONE || 'Asia/Kolkata' }
    return res.json({
      appointment,
      status: 'ok',
      step1: { raw_text: rawText || '', confidence: Number(ocrConfidence.toFixed(2)) },
      entities: llmResult.entities,
      entities_confidence: entitiesConfidence,
      normalization_confidence: Number(normalizationConfidence.toFixed(2))
    })
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message })
  }
})

export default router
