# POI API Client Integration Guide

This guide provides examples for integrating the Molecule Proof of Invention (POI) API with client applications.

## API Endpoint

```
POST /api/v1/inventions
```

## Environment Setup

First, set your environment variables:

```bash
# In your .env file
POI_API_KEY=your-secure-api-key-here
POI_CONTRACT_ADDRESS=0x1DEA29b04a59000b877979339a457d5aBE315b52
```

## 1. cURL Examples

### Basic cURL Request

```bash
curl -X POST \
  http://localhost:3000/api/v1/inventions \
  -H 'Authorization: Bearer your-api-key-here' \
  -H 'Content-Type: multipart/form-data' \
  -F 'files=@document1.pdf' \
  -F 'files=@document2.pdf'
```

### cURL with Multiple File Types

```bash
curl -X POST \
  http://localhost:3000/api/v1/inventions \
  -H 'Authorization: Bearer your-api-key-here' \
  -H 'Content-Type: multipart/form-data' \
  -F 'files=@research_paper.pdf' \
  -F 'files=@lab_notes.docx' \
  -F 'files=@data_analysis.xlsx' \
  -F 'files=@experiment_video.mp4' \
  --verbose
```

### cURL with Error Handling

```bash
#!/bin/bash

API_KEY="your-api-key-here"
API_URL="http://localhost:3000/api/v1/inventions"

response=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@document1.pdf" \
  -F "files=@document2.pdf")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" -eq 200 ]; then
    echo "Success! Response:"
    echo "$body" | jq '.'
else
    echo "Error (HTTP $http_code):"
    echo "$body" | jq '.'
fi
```

## 2. JavaScript/Node.js Integration

### Using fetch with FormData

```javascript
async function submitProofOfInvention(files, apiKey) {
  const formData = new FormData();
  
  // Add files to form data
  files.forEach(file => {
    formData.append('files', file);
  });

  try {
    const response = await fetch('/api/v1/inventions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      console.log('Proof of invention generated:', result);
      return result;
    } else {
      console.error('Error:', result.error.message);
      throw new Error(result.error.message);
    }
  } catch (error) {
    console.error('Network error:', error);
    throw error;
  }
}

// Usage example
const fileInput = document.getElementById('fileInput');
const files = Array.from(fileInput.files);
const apiKey = 'your-api-key-here';

submitProofOfInvention(files, apiKey)
  .then(result => {
    // Handle success
    console.log('Merkle root:', result.result.root);
    console.log('Transaction data:', result.result.transaction);
  })
  .catch(error => {
    // Handle error
    console.error('Failed to generate proof:', error);
  });
```

### Using axios

```javascript
import axios from 'axios';

async function generatePOI(files, apiKey) {
  const formData = new FormData();
  
  files.forEach(file => {
    formData.append('files', file);
  });

  try {
    const response = await axios.post('/api/v1/inventions', formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'multipart/form-data'
      }
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      // Server responded with error status
      throw new Error(error.response.data.error.message);
    } else if (error.request) {
      // Request was made but no response received
      throw new Error('No response from server');
    } else {
      // Something else happened
      throw new Error('Request failed: ' + error.message);
    }
  }
}
```

### Node.js with form-data

```javascript
const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');

async function submitPOIFromFiles(filePaths, apiKey) {
  const form = new FormData();
  
  // Add files from file system
  filePaths.forEach(filePath => {
    form.append('files', fs.createReadStream(filePath));
  });

  try {
    const response = await fetch('http://localhost:3000/api/v1/inventions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders()
      },
      body: form
    });

    const result = await response.json();
    
    if (response.ok) {
      return result;
    } else {
      throw new Error(result.error.message);
    }
  } catch (error) {
    console.error('Error submitting POI:', error);
    throw error;
  }
}

// Usage
const filePaths = ['./document1.pdf', './document2.docx'];
const apiKey = 'your-api-key-here';

submitPOIFromFiles(filePaths, apiKey)
  .then(result => {
    console.log('POI generated successfully:', result);
  })
  .catch(error => {
    console.error('Failed:', error);
  });
```

## 3. React Component Example

```jsx
import React, { useState } from 'react';

const POIUploader = ({ apiKey }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
    setError(null);
    setResult(null);
  };

  const submitPOI = async () => {
    if (files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await fetch('/api/v1/inventions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error.message);
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="poi-uploader">
      <h3>Proof of Invention Generator</h3>
      
      <div className="file-input">
        <input
          type="file"
          multiple
          onChange={handleFileChange}
          accept="*/*"
        />
        <p>Selected files: {files.length}</p>
      </div>

      <button 
        onClick={submitPOI} 
        disabled={loading || files.length === 0}
      >
        {loading ? 'Generating Proof...' : 'Generate Proof of Invention'}
      </button>

      {error && (
        <div className="error">
          <h4>Error:</h4>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="result">
          <h4>Proof Generated Successfully!</h4>
          <div className="result-details">
            <p><strong>Merkle Root:</strong> {result.result.root}</p>
            <p><strong>Contract Address:</strong> {result.result.transaction.recipient}</p>
            <p><strong>Files Processed:</strong> {result.result.files.length}</p>
            
            <h5>File Details:</h5>
            <ul>
              {result.result.files.map((file, index) => (
                <li key={index}>
                  {file.filename} - {file.size} bytes - {file.hash.substring(0, 10)}...
                </li>
              ))}
            </ul>
            
            <h5>Next Steps:</h5>
            <p>Submit this transaction to the blockchain:</p>
            <pre>
              {JSON.stringify(result.result.transaction, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default POIUploader;
```

## 4. Vue.js Component Example

```vue
<template>
  <div class="poi-uploader">
    <h3>Proof of Invention Generator</h3>
    
    <div class="file-input">
      <input
        type="file"
        multiple
        @change="handleFileChange"
        ref="fileInput"
      />
      <p>Selected files: {{ files.length }}</p>
    </div>

    <button 
      @click="submitPOI" 
      :disabled="loading || files.length === 0"
    >
      {{ loading ? 'Generating Proof...' : 'Generate Proof of Invention' }}
    </button>

    <div v-if="error" class="error">
      <h4>Error:</h4>
      <p>{{ error }}</p>
    </div>

    <div v-if="result" class="result">
      <h4>Proof Generated Successfully!</h4>
      <div class="result-details">
        <p><strong>Merkle Root:</strong> {{ result.result.root }}</p>
        <p><strong>Contract Address:</strong> {{ result.result.transaction.recipient }}</p>
        <p><strong>Files Processed:</strong> {{ result.result.files.length }}</p>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'POIUploader',
  props: {
    apiKey: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      files: [],
      loading: false,
      result: null,
      error: null
    };
  },
  methods: {
    handleFileChange(event) {
      this.files = Array.from(event.target.files);
      this.error = null;
      this.result = null;
    },
    
    async submitPOI() {
      if (this.files.length === 0) {
        this.error = 'Please select at least one file';
        return;
      }

      this.loading = true;
      this.error = null;

      const formData = new FormData();
      this.files.forEach(file => {
        formData.append('files', file);
      });

      try {
        const response = await fetch('/api/v1/inventions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: formData
        });

        const data = await response.json();

        if (response.ok) {
          this.result = data;
        } else {
          this.error = data.error.message;
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
```

## 5. Error Handling Examples

### Complete Error Handling Function

```javascript
async function handlePOISubmission(files, apiKey) {
  // Validate inputs
  if (!files || files.length === 0) {
    throw new Error('No files selected');
  }

  if (!apiKey) {
    throw new Error('API key is required');
  }

  // Check file size limit (100MB total)
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const maxSize = 100 * 1024 * 1024; // 100MB
  
  if (totalSize > maxSize) {
    throw new Error(`Total file size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds 100MB limit`);
  }

  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });

  try {
    const response = await fetch('/api/v1/inventions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error codes
      switch (response.status) {
        case 400:
          throw new Error(`Validation Error: ${data.error.message}`);
        case 401:
          throw new Error('Authentication failed. Please check your API key.');
        case 413:
          throw new Error('File size too large. Maximum 100MB total.');
        case 429:
          throw new Error('Rate limit exceeded. Please try again later.');
        case 500:
          throw new Error('Server error. Please try again later.');
        default:
          throw new Error(`HTTP ${response.status}: ${data.error.message}`);
      }
    }

    return data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your connection.');
    }
    throw error;
  }
}
```

## 6. Testing the API

### Test Script

```bash
#!/bin/bash

# Test script for POI API
API_KEY="your-api-key-here"
API_URL="http://localhost:3000/api/v1/inventions"

echo "Testing POI API..."

# Create test files
echo "Test document 1 content" > test1.txt
echo "Test document 2 content" > test2.txt

# Test successful request
echo "1. Testing successful request..."
curl -s -X POST \
  "$API_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@test1.txt" \
  -F "files=@test2.txt" | jq '.'

# Test missing auth
echo -e "\n2. Testing missing authentication..."
curl -s -X POST \
  "$API_URL" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@test1.txt" | jq '.'

# Test no files
echo -e "\n3. Testing no files..."
curl -s -X POST \
  "$API_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: multipart/form-data" | jq '.'

# Cleanup
rm test1.txt test2.txt

echo "Testing complete!"
```

## 7. Response Processing

### Extract Transaction Data for Blockchain Submission

```javascript
function processPOIResponse(response) {
  if (!response.success) {
    throw new Error(response.error.message);
  }

  const { result } = response;
  
  return {
    // For blockchain submission
    transactionData: {
      to: result.transaction.recipient,
      data: result.transaction.payload,
      // Add gas estimation, value, etc. as needed
    },
    
    // For verification/storage
    proofData: {
      merkleRoot: result.root,
      merkleTree: result.merkleTree,
      files: result.files,
      timestamp: response.metadata.timestamp
    },
    
    // Metadata
    metadata: response.metadata
  };
}

// Usage with blockchain submission (example with ethers.js)
async function submitToBlockchain(poiResponse, wallet) {
  const processedData = processPOIResponse(poiResponse);
  
  const tx = await wallet.sendTransaction({
    to: processedData.transactionData.to,
    data: processedData.transactionData.data,
    // Add gas limit, gas price, etc.
  });
  
  console.log('Transaction submitted:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('Transaction confirmed:', receipt);
  
  return {
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    proofData: processedData.proofData
  };
}
```

This comprehensive guide provides everything needed to integrate the POI API with various client applications and frameworks. 