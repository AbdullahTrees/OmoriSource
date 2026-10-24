// Turn an OMORI install (encrypted Steam release or already-decrypted copy)
// into a plain www/ folder that matches tools/reference.sha256.
//
// Usage: node tools/extract.js <OMORI install or its www folder> <output www folder> [--key KEY]
//
// The Steam release is encrypted. The key is never embedded here: it is found
// in a .bat/.sh/.cmd launch script next to the game, in appinfo.vdf, in
// OMORI_KEY/OMORI_AES_KEY, in omori-key.txt/key.txt, or passed with --key.
//
// Every source file is handled on its own, so encrypted, decrypted and mixed
// installs all work:
//   .OMORI/.KEL/.AUBREY/.HERO/.PLUTO  AES-256-CTR (first 16 bytes are the IV)
//   .rpgmvp/.rpgmvo                   RPG Maker MV header + XOR (key in System.json)
//   anything else                     copied, or AES-decrypted when that is what
//                                     makes it match the manifest (donottouch.xlsx)
// Then tools/steam-to-reference.patch is applied to files that still differ,
// and files that are not part of the game (Steam libraries) are left out.
//
// Problems are reported as warnings; the output is still written so the game
// can run. Written for Node 9 (the Node inside NW.js 0.29).

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var TOOLS = __dirname;
var AES_KEY = null;
var AES_EXT = { '.OMORI': '.js', '.KEL': '.json', '.AUBREY': '.json', '.HERO': '.yaml', '.PLUTO': '.yaml' };
var RPG_EXT = { '.rpgmvp': '.png', '.rpgmvo': '.ogg', '.rpgmvm': '.m4a' };
var RPG_HEADER_LENGTH = 16;

var warnings = [];
function warn(message) {
    warnings.push(message);
    console.warn('WARNING: ' + message);
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// The key is the 32-character hexadecimal string that Steam passes to OMORI as
// an argument. It is never shipped with this tool: it is found in the player's
// own install, launch script, appinfo.vdf, environment, or a key file.
function validKey(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{32}$/.test(value) ? value : null;
}

function stripKey(value) {
    var key = typeof value === 'string' ? value.trim() : '';
    if (key.indexOf('--') === 0) key = key.slice(2);
    return validKey(key);
}

function scanKey(buffer) {
    for (var i = 0; i + 34 <= buffer.length; i++) {
        if (buffer[i] !== 45 || buffer[i + 1] !== 45) continue;
        var key = buffer.toString('latin1', i + 2, i + 34);
        if (!validKey(key)) continue;
        if (i + 34 < buffer.length && /[0-9a-fA-F]/.test(String.fromCharCode(buffer[i + 34]))) continue;
        return key;
    }
    return null;
}

function scanKeyFile(file) {
    var fd;
    try {
        fd = fs.openSync(file, 'r');
    } catch (e) {
        return null;
    }
    var chunk = Buffer.alloc(1 << 20);
    var carry = Buffer.alloc(0);
    try {
        for (;;) {
            var read = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (read <= 0) break;
            var window = Buffer.concat([carry, chunk.slice(0, read)]);
            var key = scanKey(window);
            if (key) return key;
            carry = window.slice(Math.max(0, window.length - 64));
        }
    } finally {
        fs.closeSync(fd);
    }
    return null;
}

function aesDecryptWith(key, buffer) {
    var decipher = crypto.createDecipheriv('aes-256-ctr', key, buffer.slice(0, 16));
    return Buffer.concat([decipher.update(buffer.slice(16)), decipher.final()]);
}

function keyWorks(source, files, key) {
    var rel = files.filter(function (file) { return file.toLowerCase() === 'data/system.kel'; })[0];
    if (!rel) return false;
    try {
        var data = aesDecryptWith(key, fs.readFileSync(path.join(source, rel)));
        return data.length > 2 && data.toString('latin1', 0, 1) === '{';
    } catch (e) {
        return false;
    }
}

function topLevelNames(dir) {
    try {
        return fs.readdirSync(dir);
    } catch (e) {
        return [];
    }
}

function findKey(source, outDir, files, validate) {
    var parent = path.dirname(source);
    var candidates = [];
    var seen = {};
    function add(value, label) {
        var key = null;
        if (Buffer.isBuffer(value)) {
            key = scanKey(value);
        } else if (typeof value === 'string') {
            key = scanKey(Buffer.from(value, 'latin1')) || stripKey(value);
        }
        if (!key || seen[key]) return;
        seen[key] = true;
        candidates.push({ key: key, label: label });
    }

    for (var i = 4; i < process.argv.length; i++) {
        if (process.argv[i] === '--key' && process.argv[i + 1]) add(process.argv[i + 1], '--key');
    }
    add(process.env.OMORI_KEY, 'OMORI_KEY');
    add(process.env.OMORI_AES_KEY, 'OMORI_AES_KEY');

    [source, parent].forEach(function (dir) {
        topLevelNames(dir).forEach(function (name) {
            if (!/\.(bat|cmd|sh)$/i.test(name)) return;
            try {
                add(fs.readFileSync(path.join(dir, name), 'latin1'), path.join(dir, name));
            } catch (e) {
                // unreadable launch script; try the next source
            }
        });
    });

    var appinfo = [
        path.join(source, 'appinfo.vdf'),
        path.join(parent, 'appinfo.vdf'),
        path.join(outDir, '..', 'appinfo.vdf'),
        path.join(process.env.HOME || '', '.steam/steam/appcache/appinfo.vdf'),
        path.join(process.env.HOME || '', '.local/share/Steam/appcache/appinfo.vdf')
    ];
    if (process.platform === 'win32') {
        appinfo.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            'Steam/appcache/appinfo.vdf'));
        appinfo.push(path.join(process.env.ProgramFiles || 'C:\\Program Files',
            'Steam/appcache/appinfo.vdf'));
    }
    appinfo.forEach(function (file) {
        add(scanKeyFile(file), file);
    });

    ['omori-key.txt', 'key.txt'].forEach(function (name) {
        [source, parent, path.dirname(outDir)].forEach(function (dir) {
            try {
                add(fs.readFileSync(path.join(dir, name), 'latin1'), path.join(dir, name));
            } catch (e) {
                // no key file here
            }
        });
    });

    if (!validate) return candidates[0] || null;
    for (var j = 0; j < candidates.length; j++) {
        if (keyWorks(source, files, candidates[j].key)) return candidates[j];
    }
    return null;
}

function aesDecrypt(buffer) {
    if (!AES_KEY) throw new Error('missing OMORI AES key');
    return aesDecryptWith(AES_KEY, buffer);
}

function rpgDecrypt(buffer, key) {
    var body = Buffer.from(buffer.slice(RPG_HEADER_LENGTH));
    for (var i = 0; i < RPG_HEADER_LENGTH; i++) body[i] ^= key[i];
    return body;
}

function makeDirs(dir) {
    if (fs.existsSync(dir)) return;
    makeDirs(path.dirname(dir));
    fs.mkdirSync(dir);
}

function listFiles(root) {
    var files = [];
    (function walk(dir, rel) {
        fs.readdirSync(dir).forEach(function (name) {
            var full = path.join(dir, name);
            var childRel = rel ? rel + '/' + name : name;
            if (fs.statSync(full).isDirectory()) walk(full, childRel);
            else files.push(childRel);
        });
    })(root, '');
    return files;
}

function readManifest() {
    var manifest = {};
    fs.readFileSync(path.join(TOOLS, 'reference.sha256'), 'utf8').split('\n').forEach(function (line) {
        if (line) manifest[line.slice(66)] = line.slice(0, 64);
    });
    return manifest;
}

// Applies a unified diff whose content is read byte-for-byte (latin1), so CRLF
// line endings in the game's scripts survive. Returns the names of patched files.
function applyPatch(patchText, outDir, manifest) {
    var lines = patchText.match(/[^\n]*\n|[^\n]+$/g) || [];
    var patched = [];
    var i = 0;
    while (i < lines.length) {
        if (lines[i].indexOf('--- ') !== 0) { i++; continue; }
        var rel = lines[i + 1].slice('+++ b/'.length).replace(/\n$/, '');
        i += 2;
        var hunks = [];
        while (i < lines.length && lines[i].indexOf('@@ ') === 0) {
            var m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
            var hunk = { start: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], entries: [] };
            var remainingOld = hunk.oldCount, remainingNew = m[4] === undefined ? 1 : +m[4];
            i++;
            while (remainingOld > 0 || remainingNew > 0 || (i < lines.length && lines[i][0] === '\\')) {
                var line = lines[i++];
                if (line[0] === '\\') { // "\ No newline at end of file"
                    var last = hunk.entries[hunk.entries.length - 1];
                    last.text = last.text.replace(/\n$/, '');
                    continue;
                }
                hunk.entries.push({ op: line[0], text: line.slice(1) });
                if (line[0] !== '+') remainingOld--;
                if (line[0] !== '-') remainingNew--;
            }
            hunks.push(hunk);
        }

        var file = path.join(outDir, rel);
        if (!fs.existsSync(file)) { warn('patch: ' + rel + ' is missing, not patched'); continue; }
        var original = fs.readFileSync(file);
        if (manifest[rel] === sha256(original)) continue; // already the reference version

        var old = original.toString('latin1').match(/[^\n]*\n|[^\n]+$/g) || [];
        var out = [], pos = 0, ok = true;
        hunks.forEach(function (hunk) {
            if (!ok) return;
            var copyUntil = hunk.oldCount === 0 ? hunk.start : hunk.start - 1;
            while (pos < copyUntil) out.push(old[pos++]);
            hunk.entries.forEach(function (entry) {
                if (!ok) return;
                if (entry.op === '+') { out.push(entry.text); return; }
                if (old[pos] !== entry.text) { ok = false; return; }
                if (entry.op === ' ') out.push(old[pos]);
                pos++;
            });
        });
        if (!ok) { warn('patch: ' + rel + ' does not match the expected Steam version, left unpatched'); continue; }
        while (pos < old.length) out.push(old[pos++]);
        fs.writeFileSync(file, Buffer.from(out.join(''), 'latin1'));
        patched.push(rel);
    }
    return patched;
}

function main() {
    var source = process.argv[2], outDir = process.argv[3];
    if (!source || !outDir) {
        console.log('usage: node tools/extract.js <OMORI install or its www folder> <output www folder>');
        return 2;
    }
    if (fs.existsSync(path.join(source, 'www', 'index.html'))) source = path.join(source, 'www');
    if (!fs.existsSync(path.join(source, 'index.html'))) {
        console.error('ERROR: no index.html in ' + source + ' (expected an OMORI install or its www folder)');
        return 2;
    }
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
        console.error('ERROR: output folder ' + outDir + ' is not empty');
        return 2;
    }

    var manifest = readManifest();
    var sourceFiles = listFiles(source);
    var systemRel = sourceFiles.filter(function (file) { return file.toLowerCase() === 'data/system.kel'; })[0] || null;
    var systemJsonRel = sourceFiles.filter(function (file) { return file.toLowerCase() === 'data/system.json'; })[0] || null;
    var aesFiles = sourceFiles.filter(function (file) { return AES_EXT[path.extname(file)]; });
    if (systemRel || aesFiles.length) {
        var found = findKey(source, outDir, sourceFiles, !!systemRel);
        if (!found) {
            console.error('ERROR: this OMORI install is encrypted and no decryption key was found.');
            console.error('Put the key in key.txt next to the game folder, copy Steam\'s appcache/appinfo.vdf next to it, or pass --key.');
            return 2;
        }
        AES_KEY = found.key;
        console.log('key: found in ' + found.label);
    }
    var system;
    if (systemRel) {
        system = JSON.parse(aesDecrypt(fs.readFileSync(path.join(source, systemRel))).toString('utf8').replace(/^﻿/, ''));
    } else if (systemJsonRel) {
        system = JSON.parse(fs.readFileSync(path.join(source, systemJsonRel), 'utf8').replace(/^﻿/, ''));
    } else {
        console.error('ERROR: no data/System.json or data/System.KEL in ' + source);
        return 2;
    }
    var rpgKey = Buffer.from(system.encryptionKey || '', 'hex');

    var counts = { aes: 0, rpg: 0, copied: 0 }, skipped = [];
    sourceFiles.forEach(function (rel) {
        var ext = path.extname(rel);
        var data = fs.readFileSync(path.join(source, rel));
        var target = rel;
        if (AES_EXT[ext]) {
            target = rel.slice(0, -ext.length) + AES_EXT[ext];
            data = aesDecrypt(data);
            counts.aes++;
        } else if (RPG_EXT[ext]) {
            target = rel.slice(0, -ext.length) + RPG_EXT[ext];
            data = rpgDecrypt(data, rpgKey);
            counts.rpg++;
        } else {
            if (manifest[rel] && manifest[rel] !== sha256(data) && data.length > 16) {
                var decrypted = aesDecrypt(data);
                if (sha256(decrypted) === manifest[rel]) { data = decrypted; counts.aes++; }
            }
            counts.copied++;
        }
        if (!manifest[target]) { skipped.push(rel); return; }
        if (target === 'data/System.json' && sha256(data) !== manifest[target]) {
            // Assets are written decrypted, so tell RPG Maker not to decrypt them again.
            // A targeted edit instead of a patch hunk: System.json is one long line.
            data = Buffer.from(data.toString('utf8')
                .replace('"encryptionKey":"' + system.encryptionKey + '"', '"encryptionKey":""')
                .replace('"hasEncryptedImages":true', '"hasEncryptedImages":false')
                .replace('"hasEncryptedAudio":true', '"hasEncryptedAudio":false'), 'utf8');
        }
        var file = path.join(outDir, target);
        makeDirs(path.dirname(file));
        fs.writeFileSync(file, data);
    });
    console.log('decrypted ' + counts.aes + ' AES files and ' + counts.rpg + ' images/audio, copied ' + counts.copied + ' plain files');
    if (skipped.length) console.log('left out ' + skipped.length + ' files that are not part of the game (Steam libraries, leftovers): ' + skipped.join(', '));

    var patchFile = path.join(TOOLS, 'steam-to-reference.patch');
    if (fs.existsSync(patchFile)) {
        var patched = applyPatch(fs.readFileSync(patchFile, 'latin1'), outDir, manifest);
        console.log('patched ' + patched.length + ' files: ' + patched.join(', '));
    } else {
        warn('no ' + patchFile + ', Steam code files left unpatched');
    }

    var missing = 0, changed = 0;
    Object.keys(manifest).forEach(function (rel) {
        var file = path.join(outDir, rel);
        if (!fs.existsSync(file)) { missing++; warn('missing ' + rel); }
        else if (sha256(fs.readFileSync(file)) !== manifest[rel]) { changed++; warn('differs from reference: ' + rel); }
    });
    console.log(Object.keys(manifest).length + ' expected, ' + missing + ' missing, ' + changed + ' changed');
    if (warnings.length) console.warn(warnings.length + ' warning(s); the game may still run but is not identical to the reference');
    return 0;
}

process.exitCode = main();
