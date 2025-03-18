const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Check if FFmpeg is installed
ffmpeg()
    .on('start', function(cmd) {
        console.log('FFmpeg is installed. Command:', cmd);
    })
    .on('error', function(err) {
        console.error('FFmpeg error:', err);
    });

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// AES encryption function
function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// AES decryption function
function decrypt(encryptedText, key) {
    const textParts = encryptedText.split(':');
    if (textParts.length < 2) {
        throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(textParts[0], 'hex');
    const encryptedData = Buffer.from(textParts[1], 'hex');
    const decodedKey = Buffer.from(key, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-cbc', decodedKey, iv);
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
}

// Function to embed data into video
function embedData(videoPath, secretData, outputPath) {
    return new Promise((resolve, reject) => {
        const sanitizedData = secretData.replace(/:/g, '\\:').replace(/'/g, "’");
        const fontPath = '/System/Library/Fonts/Supplemental/Arial.ttf'; // Adjust this path as needed

        if (!fs.existsSync(fontPath)) {
            return reject(new Error(`Font file not found: ${fontPath}`));
        }

        const command = ffmpeg(videoPath)
            .outputOptions([
                '-vf', `drawtext=text='${sanitizedData}':x=10:y=10:fontsize=24:fontcolor=white:fontfile=${fontPath}`,
                '-preset', 'ultrafast'
            ])
            .on('start', function(cmd) {
                console.log('Running FFmpeg command:', cmd);
            })
            .on('end', function() {
                console.log('FFmpeg processing finished successfully.');
                resolve();
            })
            .on('error', function(err) {
                console.error('FFmpeg Error:', err);
                reject(err);
            })
            .save(outputPath);
    });
}

// Endpoint to handle video embedding
app.post('/embed', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No video file uploaded.');
        }

        const secretData = req.body.secretData;
        const videoPath = path.join(__dirname, req.file.path);
        const outputPath = path.join(__dirname, 'uploads', 'output.mp4');

        // Generate a 32-byte AES key
        const key = crypto.randomBytes(32);
        console.log(`Generated Key: ${key.toString('hex')}`);

        // Encrypt secret data twice
        const firstEncryptedData = encrypt(secretData, key);
        const secondEncryptedData = encrypt(firstEncryptedData, key);
        console.log('Encrypted Data:', secondEncryptedData);

        // Embed data into the video
        await embedData(videoPath, secondEncryptedData, outputPath);

        res.json({
            firstEncryptedData,
            secondEncryptedData,
            videoPath: '/uploads/output.mp4',
            key: key.toString('hex')
        });
    } catch (error) {
        console.error('Embedding Error:', error);
        res.status(500).send(`Error during processing: ${error.message}`);
    }
});

// Endpoint to handle decryption
app.post('/decrypt', (req, res) => {
    try {
        console.log('Request body:', req.body);

        const { encryptedText, key } = req.body;

        if (!encryptedText || !key) {
            return res.status(400).send('Both encryptedText and key are required.');
        }

        const decodedKey = Buffer.from(key, 'hex');
        const decryptedText = decrypt(encryptedText, decodedKey);
        console.log('Decrypted Text:', decryptedText);

        const originalSecretData = decrypt(decryptedText, decodedKey);
        console.log('Original Secret Data:', originalSecretData);

        res.json({
            decryptedText,
            originalSecretData
        });
    } catch (error) {
        console.error('Decryption Error:', error);
        res.status(500).send(`Error during decryption: ${error.message}`);
    }
});

// Start the server
app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
