const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Serve static files
app.use('/3dhop', express.static(path.join(__dirname, '3dhop')));
app.use('/potree', express.static(path.join(__dirname, 'potree')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));

// Router to handle incoming modelId
app.get('/:type', (req, res) => {
  const queryName = req.query.q; // Fetch the 'q' parameter
  const modelType = req.params.type; // "potree" or "3dhop"

  //sample url would look like http://localhost:5173/potree/?q=tobin93 for potree links
  if (modelType === 'potree') {
    fs.readFile(path.join(__dirname, 'potree', 'potree.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        res.status(500).send('Internal Server Error');
        return;
      }
      
      // Check if queryName exists before replacing
      if (queryName) {
        const modifiedData = data.replace('PLACEHOLDER_QUERY', queryName);
        console.log(queryName)
        res.send(modifiedData);
      } else {
        res.status(400).send('Invalid query parameter');
      }
    });
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
