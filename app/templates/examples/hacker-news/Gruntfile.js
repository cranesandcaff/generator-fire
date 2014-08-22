var path = require('path');
var fs = require('fs');
var Q = require('q');

function mkdir(dirPath) {
    var defer = Q.defer();
    fs.mkdir(dirPath, function() {
        defer.resolve(true);
    });
    return defer.promise;
}

module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        build: {
            migrations: {},
            api: {},
            scripts: {}
        },
        release: {
            migrate: {}
        },
        run: {

        }
    });

    // TODO: The task should be executed by code from the fire module as we need to be able to update the code.

    grunt.registerMultiTask('release', function(version) {
        var dotenv = require('fire/node_modules/dotenv');
        dotenv.load();

        var Models = require('fire/lib/modules/models');
        var Migrations = require('fire/lib/modules/migrations');

        var models = new Models();
        var migrations = new Migrations();

        var targetVersion = version;

        var done = this.async();
        var basePath = process.cwd();

        // Set-up without reading any of the models
        // We will create the models based on all migrations
        models.setup(null)
            .then(function() {
                return migrations.setup(path.join(basePath, '_migrations'), models);
            })
            .then(function() {
                if(migrations._.length === 0) {
                    throw new Error('There are 0 migration files. Did you run `fire generate migrations`?');
                }
            })
            .then(function() {
                // Let's find which database version we're at
                return migrations.currentVersion();
            })
            .then(function(currentVersion) {
                if(!targetVersion) {
                    targetVersion = migrations._[migrations._.length - 1].version;
                }

                console.log('*** Migrating from `' + currentVersion + '` to `' + targetVersion + '`.');

                // TODO: First do a check if currentVersion and targetVersion are different OR do not throw an error in migrate when versions are the same.

                return migrations.migrate(currentVersion, targetVersion);
            })
            .then(function() {
                return migrations.currentVersion();
            })
            .then(function(currentVersion) {
                if(currentVersion == targetVersion) {
                    //everything went alright
                    console.log('*** Migration successful to `' + targetVersion + '`.');
                }
                else {
                    throw new Error('Database version after migration `' + currentVersion + '` does not match target version `' + targetVersion + '`.');
                }
            })
            .then(function() {
                done();
            })
            .catch(function(error) {
                console.log(error.message);
                console.log(error.stack);

                throw error;
            })
            .done();
    });

    grunt.registerMultiTask('build', function() {
        var done = this.async();
        var basePath = process.cwd();

        // TODO: ... or maybe we should just call fire.removeApp(...).

        var name = require.resolve('fire');
        if(typeof require.cache[name] != 'undefined') {
            delete require.cache[name];
        }

        var moduleName = require.resolve(path.join(basePath, 'index.js'));
        if(typeof require.cache[moduleName] != 'undefined') {
            delete require.cache[moduleName];
        }

        var fire = require('fire');
        fire.disabled = true;
        fire.appsMap = {};

        require(path.join(basePath, 'index.js'));

        var app = fire.app(Object.keys(fire.appsMap)[0]);

        if(this.target == 'migrations') {
            mkdir(path.join(basePath, '_migrations'))
                .then(function() {
                    var Generate = require('fire/lib/modules/migrations/generate');
                    var generate = new Generate(app, basePath);
                    generate.delegate = {
                        addMigration: function(fileName, stream) {
                            var writeStream = fs.createWriteStream(path.join(basePath, '_migrations', fileName));
                            stream.pipe(writeStream);
                        }
                    };

                    return generate.createMigrations()
                        .then(function() {
                            done();
                        });
                })
                .done();
        }
        else if(this.target == 'api') {
            app.controllers.setup(basePath)
                .then(function() {
                    return app.models.setup(basePath);
                })
                .then(function() {
                    var defer = Q.defer();

                    setImmediate(function() {
                        fs.mkdir(path.join(basePath, '_api'), function() {
                            defer.resolve();
                        });
                    });

                    return defer.promise;
                })
                .then(function() {
                    var result = Q.when(true);

                    app.models.forEach(function(model) {
                        result = result.then(function() {
                            var modelName = model.getName();
                            var writeStream = fs.createWriteStream(path.join(basePath, '_api', model.getFileName() + '.js'));
                            return app.aPI.generateModelController(model, writeStream);
                        });
                    });

                    return result;
                })
                .then(function() {
                    done();
                })
                .done();
        }
        else if(this.target == 'scripts') {
            app.controllers.setup(basePath)
                .then(function() {
                    return app.models.setup(basePath);
                })
                .then(function() {
                    setImmediate(function() {
                        fs.mkdir(path.join(basePath, '_assets'), function() {
                            var writeStream = fs.createWriteStream(path.join(basePath, '_assets', 'fire.js'));

                            app.bridge.generate(writeStream)
                                .then(function() {
                                    done();
                                })
                                .done();
                        });
                    });
                })
                .done();
        }
    });
};
