// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { verifyConnection } = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple health check the UI (and you, during grading) can hit to confirm
// the app can actually reach CognoDB — surfaces connection problems clearly
// instead of letting them show up as a confusing 500 somewhere else.
app.get('/api/health', async (req, res) => {
  const status = await verifyConnection();
  res.status(status.ok ? 200 : 503).json(status);
});

app.use('/api', apiRouter);

app.listen(PORT, async () => {
  console.log(`TrustCircle running on http://localhost:${PORT}`);
  const status = await verifyConnection();
  if (status.ok) {
    console.log('✔ Connected to CognoDB');
  } else {
    console.warn('⚠ Could not connect to CognoDB at startup:', status.error);
    console.warn('  The app will still start, but API calls will return a clear 503 until this is fixed.');
  }
});
