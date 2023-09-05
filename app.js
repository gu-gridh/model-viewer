const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Serve static files
app.use('/mesh', express.static(path.join(__dirname, 'mesh')));
app.use('/pointcloud', express.static(path.join(__dirname, 'pointcloud')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));

// Change the variables here:
const configData = require('./config.json'); // Load the configuration file for testing. 
// Will be replaced by API call...

/*
Sample URLs for testing:
http://localhost:5173/pointcloud/?q=tobin93 directs to the Pointcloud Viewer
http://localhost:5173/mesh/?q=gargo directs to the 3dhop Viewer 
*/

// Router to handle incoming modelId
app.get('/:type', (req, res) => {
  const queryName = req.query.q; // Fetch the 'q' parameter
  const modelType = req.params.type; // "pointcloud" or "mesh"

  if (modelType === 'pointcloud' || modelType === 'mesh') {
    fs.readFile(path.join(__dirname, modelType, `${modelType}.html`), 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        res.status(500).send('Internal Server Error');
        return;
      }

      let modifiedData = data.replace('PLACEHOLDER_QUERY', queryName || '');
    
      if (configData[modelType] && configData[modelType][queryName]) {
        for (const [key, value] of Object.entries(configData[modelType][queryName])) {
          modifiedData = modifiedData.replace(new RegExp(`PLACEHOLDER_${key.toUpperCase()}`, 'g'), JSON.stringify(value));
        }
      }
      res.send(modifiedData);
    });
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
