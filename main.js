#!/usr/bin/env node

const yaml = require('js-yaml'),
AdmZip = require('adm-zip'),
fse = require('fs-extra');

const utils = require('./utils.js');
const program = require('commander');

program
.name('IceCanary')
.version('1.0.0')
.option('-f, --file <buildfile>', 'change the build configure file, defaults to "./icecanary.yml"', './icecanary.yml')
.option('-o, --output <outputfolder>', 'set output folder, defaults to "outputs"', 'outputs')
.option('-z, --nozip', 'do not create ZIP archive')
.option('-mcv, --mcversion <minecraft version>', 'set version of minecraft to use for cache minecraft assets, will override minecraft version in build file', String)
.parse(process.argv);

var buildfile = program.file;
if (!fse.existsSync(buildfile)) {
    utils.error(`Build file ${buildfile} not found.`);
}
var output = program.output;
if (!fse.existsSync(output)) {
    fse.mkdirSync(output);
} else
    fse.emptyDirSync(output);

var config, asyncHolder = utils.createASyncHolder();
try {
    config = yaml.safeLoad(fse.readFileSync(buildfile, 'utf8'));
} catch (err) {
    utils.error(`Failed to parse build file:\n${err}`);
}

var mcversion = program.mcversion ? program.mcversion : config.mcver;

var zip;
if (!program.nozip) {
    zip = new AdmZip();
    var comment = `Generated by IceCanary\nPack Name: ${config.name}\nPack Version: ${config.version}\nPack Description: ${config.description}\nTarget Minecraft Version: ${config.mcver}\n`;
    if (config.packaging_comment)
        comment += `\n${config.packaging_comment}`;
    zip.addZipComment(Buffer.alloc(comment.length, comment));
}

var exporter = program.nozip ? {
    write: function (name, content) {
        if (config.packformat >= 3)
            name = name.toLowerCase();
        var allName = output + "/" + name;
        fse.ensureFileSync(allName);
        fse.writeFileSync(allName, content);
    },
    end: function () {}
}
 : {
    write: function (name, content) {
        if (config.packformat >= 3)
            name = name.toLowerCase();
        zip.addFile(utils.trimPath(name), Buffer.alloc(content.length, content));
    },
    end: function () {
        var allName = `${output}/${config.name}-${config.mcver}-${config.version}.zip`;
        fse.ensureFileSync(allName);
        zip.writeZip(allName);
        utils.info(`Zip file outputed to ${allName}`);
    }
};
utils.info(`Building ${config.name}-${config.version}`);

// MCMeta
(function () {
    var packmeta = {
        pack: {
            description: config.description,
            pack_format: config.packformat
        }
    };
    if (config.languages) {
        packmeta.language = {};
        for (n in config.languages) {
            var langCfg = config.languages[n];
            if (langCfg.bidirectional == undefined)
                langCfg.bidirectional = false;
            packmeta.language[n] = {
                name: langCfg.name,
                region: langCfg.region,
                bidirectional: langCfg.bidirectional
            };
        }
    }
    exporter.write("pack.mcmeta", JSON.stringify(packmeta));
})();

// Icon
(function () {
    if (config.icon) {
        exporter.write("pack.png", fse.readFileSync(config.icon));
    }
})();

// Languages
(function () {
    if (config.languages) {
        for (n in config.languages) {
            var langCfg = config.languages[n];
            utils.info(`Creating language ${langCfg.name} as ${n}`);
            if (!langCfg.ns)
                langCfg.ns = 'minecraft';
            if (!langCfg.data.format)
                langCfg.data.format = 'json';
            if (langCfg.data.objective == undefined)
                langCfg.data.objective = false;
            var texts = {};
            switch (langCfg.data.format) {
            case 'json':
                texts = JSON.parse(fse.readFileSync(langCfg.data.file, 'utf-8').toString());
                break;
            case 'yaml':
                texts = yaml.safeLoad(fse.readFileSync(langCfg.data.file, 'utf-8'));
                break;
            default:
                utils.error(`Unknown format of language translate data for ${langCfg.name}`);
            }
            if (langCfg.data.objective) {
                var newTexts = {};
                utils.deobjectiveObject(texts, '', newTexts);
                texts = newTexts;
            }
            if (langCfg.data.type == 'merge') {
                asyncHolder.start();
                if (!langCfg.data.lang)
                    langCfg.data.lang = 'zh_CN';
                utils.getAsset(mcversion, `assets/minecraft/lang/${langCfg.data.lang}.json`, function (data) {
                    asyncHolder.end();
                    data = JSON.parse(data);
                    for (id in data) {
                        if (!texts[id])
                            texts[id] = data[id];
                    }
                    exporter.write(`assets/${langCfg.ns}/lang/${n}.json`, JSON.stringify(texts));
                });
            } else
                exporter.write(`assets/${langCfg.ns}/lang/${n}.json`, JSON.stringify(texts));
        }
    }
})();

function copyFolder(base, src) {
    fse.ensureDirSync(base);
    fse.readdirSync(src).forEach(function (file) {
        if (fse.statSync(`${src}/${file}`).isDirectory()) {
            copyFolder(`${base}/${file}`, `${src}/${file}`);
        } else {
            exporter.write(`${base}/${file}`, fse.readFileSync(`${src}/${file}`));
        }
    });
}

// Raw
(function () {
    if (config.raw) {
        for (n in config.raw) {
            var path = config.raw[n];
            utils.info(`Creating raw data from ${path} as ${n}`);
            copyFolder(`assets/${n}`, path);
        }
    }
})();

// Raw to archive
(function () {
    if (config.archive_raw) {
        copyFolder('', config.archive_raw);
    }
})();

asyncHolder.setupCallback(function () {
    exporter.end();
    const SUCCESS_MESSAGE = 'Successful!';
    var chalk = utils.getChalk();
    console.log(new chalk.Instance({
            level: 1
        }).green.bold(SUCCESS_MESSAGE));
});
