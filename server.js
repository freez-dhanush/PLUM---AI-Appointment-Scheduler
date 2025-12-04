import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import appointmentRouter from './routes/appointment.js'
dotenv.config()
const app = express()
app.use(cors())
app.use(express.json())
app.use('/', appointmentRouter)
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`))
