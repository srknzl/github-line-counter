const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const {spawn} = require('child_process');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT ? process.env.PORT : 3000;

app.get('*', (req, res, next) => {
    const originalUrl = req.originalUrl;
    const splitted = originalUrl.split('/');
    const words = [];
    for (const word of splitted) {
        if (word) {
            words.push(word);
        }
    }
    if (words.length < 2 || words.length > 3) {
        return res.status(422).json({
            'status': 'Invalid path',
        });
    }
    const user = words[0];
    const repo = words[1];
    const branch = words.length == 3 ? words[2] : 'master';
    // console.log(words);
    try {
        // console.log(`https://api.github.com/repos/${user}/${repo}/branches/${branch}`);
        const fileUUID = uuid.v4();
        // console.log('created file');
        const file = fs.createWriteStream(`${fileUUID}.zip`);
        try {
            https.get(`https://codeload.github.com/${user}/${repo}/zip/${branch}`, (response) => {
                if (response.statusCode != 200) {
                    file.destroy();
                    fs.unlinkSync(`${fileUUID}.zip`);
                    return res.status(404).json({
                        'status': 'Not found',
                    });
                } else {
                    response.pipe(file);
                }
            })
                .on('error', (err) => {
                    file.destroy();
                    fs.unlinkSync(`${fileUUID}.zip`);
                    return res.status(500).json({
                        'status': 'Could not download repo',
                    });
                });
        } catch (error) {
            file.destroy();
            fs.unlinkSync(`${fileUUID}.zip`);
            return res.status(500).json({
                'status': 'Could not download repo',
            });
        }

        try {
            file.on('finish', () => {
                // console.log('finish');
                const unzipProcess = spawn('unzip', ['-o', `${fileUUID}.zip`], {
                    'stdio': 'ignore',
                });
                unzipProcess.on('exit', (code, signal) => {
                    // console.log('unzip exit');
                    if (code != 0) {
                        return res.status(500).json({
                            'status': 'Could not get code',
                        });
                    } else {
                        const clocProcess = spawn('./scc', [
                            '-f',
                            'html',
                            '-s',
                            'code',
                            `${repo}-${branch}`,
                        ], {
                            'stdio': ['ignore', 'pipe', 'pipe'],
                        });
                        clocProcess.on('exit', (code, _) => {
                            // console.log('clocProcess exit');
                            if (code != 0) {
                                let chunk;
                                clocProcess.stderr.on('readable', () => {
                                    while (null !== (chunk = clocProcess.stderr.read())) {
                                        res.write(chunk);
                                    }
                                });
                                clocProcess.stderr.on('end', () => {
                                    try {
                                        fs.unlinkSync(`${fileUUID}.zip`);
                                        fs.rmdirSync(`${repo}-${branch}`, {
                                            recursive: true,
                                        });
                                    } catch (error) {
                                        // no op
                                    }
                                    res.status(500).end();
                                });
                            } else {
                                let chunk;
                                res.setHeader('Content-Type', 'text/html');
                                clocProcess.stdout.on('readable', () => {
                                    while (null !== (chunk = clocProcess.stdout.read())) {
                                        res.write(chunk);
                                    }
                                });
                                clocProcess.stdout.on('end', () => {
                                    try {
                                        fs.unlinkSync(`${fileUUID}.zip`);
                                        fs.rmdirSync(`${repo}-${branch}`, {
                                            recursive: true,
                                        });
                                    } catch (error) {
                                        // no op
                                    }
                                    res.status(200).end();
                                });
                            }
                        });
                    }
                });
            });
        } catch (error) {
            try {
                fs.unlinkSync(`${fileUUID}.zip`);
                fs.rmdirSync(`${repo}-${branch}`, {
                    recursive: true,
                });
            } catch (error) {
                // no op
            }
            res.status(500).json({
                'status': error.toString(),
            });
        }
    } catch (error) {
        return res.status(500).send('Could not reach to github api.');
    }
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
