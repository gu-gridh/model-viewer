const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();

// Serve static files
app.use('/mesh', express.static(path.join(__dirname, 'mesh')));
app.use('/pointcloud', express.static(path.join(__dirname, 'pointcloud')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));

/*
Sample URLs for testing:
http://localhost:5177/pointcloud/?q=2 directs to the Pointcloud Viewer where q is the id of the pointcloud
http://localhost:5177/mesh/?q=gargo directs to the 3dhop Viewer 
*/

// Router to handle incoming modelId
app.get('/:type', async (req, res) => {
  const queryName = req.query.q; // Fetch the 'q' parameter
  const modelType = req.params.type; // "pointcloud" or "mesh"


  let apiUrl = '';
  console.log(modelType)

  // Set the API URL based on the modelType
  if (modelType === 'pointcloud') {
    apiUrl = `https://diana.dh.gu.se/api/etruscantombs/objectpointcloud/?id=${queryName}`;
  } else if (modelType === 'mesh') {
    apiUrl = `https://diana.dh.gu.se/api/etruscantombs/objectmesh/?id=${queryName}`;
  } else {
    res.status(400).send('Invalid model type');
    return;
  }

  try {
    const apiResponse = await axios.get(apiUrl);

    if(apiResponse.data.results && apiResponse.data.results.length > 0) {

    const modelData = apiResponse.data.results[0];

    fs.readFile(path.join(__dirname, modelType, `${modelType}.html`), 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        res.status(500).send('Internal Server Error');
        return;
      }

      // Replacing placeholders with actual data fetched from API
      let modifiedData = data;
      modifiedData = modifiedData.replace(/PLACEHOLDER_TITLE/g, JSON.stringify(modelData.title || ''));
      modifiedData = modifiedData.replace(/PLACEHOLDER_CAMERA_POSITION/g, JSON.stringify(modelData.camera_position) || '[]');
      modifiedData = modifiedData.replace(/PLACEHOLDER_LOOK_AT/g, JSON.stringify(modelData.look_at) || '[]');
      modifiedData = modifiedData.replace(/PLACEHOLDER_URL_PUBLIC/g, modelData.url_public);
      res.send(modifiedData);
    });
  }
  else {
    console.error('No results found in API response.');
    res.status(404).send('Not Found');
    return;
    }
  } catch (error) {
    console.error('Error fetching data from API:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Fallback route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '/index.html'));
});

const PORT = 5177;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
