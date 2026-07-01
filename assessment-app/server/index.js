const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth');
const classRoutes = require('./routes/classes');
const importRoutes = require('./routes/import');
const { router: testRoutes } = require('./routes/tests');
const attemptRoutes = require('./routes/attempts');
const exportRoutes = require('./routes/exportRoutes');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/import', importRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/export', exportRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get(['/teacher', '/student'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Basic error handler so unexpected exceptions return JSON, not an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Assessment app listening on http://localhost:${PORT}`);
});
