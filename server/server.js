const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const config = require('./config');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'web')));

// API routes
app.use('/api/routes', require('./routes/routes'));
app.use('/api/events', require('./routes/events'));
app.use('/api/public-config', require('./routes/public-config'));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const port = config.PORT;
app.listen(port, () => {
  console.log(`Scenic Walk server running on http://localhost:${port}`);
  if (!config.GOOGLE_API_KEY) {
    console.warn('WARNING: GOOGLE_API_KEY is not set. API calls will fail.');
  }
});
