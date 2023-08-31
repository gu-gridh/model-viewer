const express = require('express');
const path = require('path');

const app = express();

// Serve static files
app.use('/3dhop', express.static(path.join(__dirname, '3dhop')));
app.use('/potree', express.static(path.join(__dirname, 'potree')));

// Router to handle incoming modelId
app.get('/:type', (req, res) => {
  const modelId = req.query.modelId;
  const modelType = req.params.type; // "potree" or "3dhop"

  // Add logic here to validate the modelId and modelType

  if (modelType === 'potree') {
    res.sendFile(path.join(__dirname, 'potree', 'potree.html'));
  } else if (modelType === '3dhop') {
    res.sendFile(path.join(__dirname, '3dhop', '3dhop.html'));
  } else {
    res.status(400).send('Invalid model type');
  }
});

// Fallback route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
    });

const PORT = 5173;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});