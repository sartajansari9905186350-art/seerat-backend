const { videoStorage } = require('../dist/src/services/videoStorage.service');

async function runTests() {
  console.log('=== 1. Testing Video Validation with MP4 Magic Bytes ===');
  // Create a mock MP4 buffer with 'ftypisom' box
  // [0..3: size (0x00 0x00 0x00 0x20)] [4..7: 'ftyp'] [8..11: 'isom']
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x20, // box size 32
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00, // minor version
    0x69, 0x73, 0x6f, 0x6d, // compatible brand 1
    0x6d, 0x70, 0x34, 0x32  // compatible brand 2
  ]);

  // Append dummy video payload
  const dummyPayload = Buffer.alloc(1024 * 100, 0xAA); // 100 KB payload
  const fullMp4 = Buffer.concat([mp4Header, dummyPayload]);

  const mockFile = {
    buffer: fullMp4,
    size: fullMp4.length,
    mimetype: 'video/mp4',
    originalname: 'real_recitation.mp4'
  };

  const validation = videoStorage.validateVideo(mockFile);
  console.log('Validation Result:', validation);
  if (!validation.valid || validation.mimeType !== 'video/mp4' || validation.extension !== '.mp4') {
    throw new Error('Validation failed for authentic MP4 buffer');
  }

  console.log('=== 2. Testing Non-Video Rejection ===');
  const textFile = {
    buffer: Buffer.from('This is not a video file.'),
    size: 25,
    mimetype: 'text/plain',
    originalname: 'test.txt'
  };
  const invalidValidation = videoStorage.validateVideo(textFile);
  console.log('Invalid file rejection result:', invalidValidation);
  if (invalidValidation.valid) {
    throw new Error('Expected invalid file to be rejected, but it was marked valid');
  }

  console.log('=== ALL VALIDATION TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
