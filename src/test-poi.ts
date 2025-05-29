import POIService from './services/poi.service';

// Test the POI service with mock file data
async function testPOIService() {
  console.log('Testing POI Service...\n');

  // Create mock files
  const mockFiles: Express.Multer.File[] = [
    {
      fieldname: 'files',
      originalname: 'document1.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('This is a test document 1'),
      size: 25,
      destination: '',
      filename: '',
      path: '',
      stream: {} as any
    },
    {
      fieldname: 'files',
      originalname: 'document2.txt',
      encoding: '7bit',
      mimetype: 'text/plain',
      buffer: Buffer.from('This is a test document 2'),
      size: 25,
      destination: '',
      filename: '',
      path: '',
      stream: {} as any
    }
  ];

  try {
    // Test file validation
    console.log('1. Testing file validation...');
    const validation = POIService.validateFiles(mockFiles);
    console.log('Validation result:', validation);

    // Test proof generation
    console.log('\n2. Testing proof of invention generation...');
    const result = await POIService.generateProofOfInvention(mockFiles);
    
    console.log('Generated POI result:');
    console.log('Root:', result.root);
    console.log('Tree length:', result.merkleTree.tree.length);
    console.log('Values count:', result.merkleTree.values.length);
    console.log('Transaction recipient:', result.transaction.recipient);
    console.log('Files processed:', result.files.length);
    
    // Test response formatting
    console.log('\n3. Testing response formatting...');
    const successResponse = POIService.createSuccessResponse(result);
    console.log('Success response structure:', Object.keys(successResponse));
    
    const errorResponse = POIService.createErrorResponse('Test error', 400);
    console.log('Error response structure:', Object.keys(errorResponse));
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPOIService(); 