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
    if (splitted.length < 3 || splitted.length > 4) {
        return res.status(422).json({
            'status': 'Invalid path',
        });
    }
    const user = splitted[1];
    const repo = splitted[2];
    const branch = splitted.length == 4 ? splitted[3] : 'master';
    const fileUUID = uuid.v4();

    console.log(user, repo, branch);

    const file = fs.createWriteStream(`/tmp/${fileUUID}.zip`);
    try {
        https.get(`https://codeload.github.com/${user}/${repo}/zip/${branch}`, (response) => {
            if (response.statusCode != 200) {
                file.destroy();
                fs.unlinkSync(`/tmp/${fileUUID}.zip`);
                return res.status(404).json({
                    'status': 'Not found',
                });
            } else {
                response.pipe(file);
            }
        })
            .on('error', (err) => {
                file.destroy();
                fs.unlinkSync(`/tmp/${fileUUID}.zip`);
                return res.status(500).json({
                    'status': 'Could not download repo',
                });
            });
    } catch (error) {
        file.destroy();
        fs.unlinkSync(`/tmp/${fileUUID}.zip`);
        return res.status(500).json({
            'status': 'Could not download repo',
        });
    }

    try {
        file.on('finish', () => {
            const unzipProcess = spawn('unzip', [`/tmp/${fileUUID}.zip`, '-d', '/tmp'], {
                'stdio': 'ignore',
            });
            unzipProcess.on('exit', (code, signal) => {
                if (code != 0) {
                    return res.status(500).json({
                        'status': 'Could not get code',
                    });
                } else {
                    const clocProcess = spawn('node_modules/.bin/cloc', ['--json', `/tmp/${repo}-${branch}`], {
                        'stdio': ['ignore', 'pipe', 'pipe'],
                    });
                    clocProcess.on('exit', (code, _) => {
                        if (code != 0) {
                            let chunk;
                            clocProcess.stderr.on('readable', () => {
                                while (null !== (chunk = clocProcess.stderr.read())) {
                                    res.write(chunk);
                                }
                            });
                            clocProcess.stderr.on('end', () => {
                                fs.unlinkSync(`/tmp/${fileUUID}.zip`);
                                fs.rmdirSync(`/tmp/${repo}-${branch}`, {
                                    recursive: true,
                                });
                                res.status(500).end();
                            });
                        } else {
                            let chunk;
                            res.contentType('json');
                            clocProcess.stdout.on('readable', () => {
                                while (null !== (chunk = clocProcess.stdout.read())) {
                                    res.write(chunk);
                                }
                            });
                            clocProcess.stdout.on('end', () => {
                                fs.unlinkSync(`/tmp/${fileUUID}.zip`);
                                fs.rmdirSync(`/tmp/${repo}-${branch}`, {
                                    recursive: true,
                                });
                                res.status(200).end();
                            });
                        }
                    });
                }
            });
        });
    } catch (error) {
        fs.unlinkSync(`/tmp/${fileUUID}.zip`);
        fs.rmdirSync(`/tmp/${repo}-${branch}`, {
            recursive: true,
        });
        res.status(500).json({
            'status': error.toString(),
        });
    }
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
