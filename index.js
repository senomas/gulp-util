const gulp = require("gulp");
const changed = require("gulp-changed");
const log = require("fancy-log");
const debug = require("gulp-debug");
const yarn = require("gulp-yarn");
const through = require("through2");
const typescript = require("gulp-tsc");
const tslint = require("gulp-tslint");
const touch = require("gulp-touch-cmd");
const tap = require("gulp-tap");
const filter = require("gulp-filter");
const mocha = require("gulp-mocha");
const rename = require("gulp-rename");

const fs = require("fs");
const { exec, spawn } = require("child_process");
const pify = require("pify");
const rimraf = require("rimraf");
const moment = require("moment");
const yarnLock = require("yarn-lockfile");
const async = require("async");
const merge = require("merge-stream");
const source = require("vinyl-source-stream");

const processes = [];

const filterSince = src => {
  const mt = mtime(src);
  return filter(f => f.stat.mtime.getTime() > mt);
};

const filterBefore = src => {
  const mt = mtime(src);
  return filter(f => f.stat.mtime.getTime() <= mt);
};

const mtime = src => {
  try {
    return fs.statSync(src).mtime.getTime();
  } catch (err) {
    return 0;
  }
};

const touchFile = src => {
  fs.closeSync(fs.openSync(src, "w"));
};

const spawnWrap = (cmd, options = {}) => {
  const stream = source("spawn.log");
  if (typeof options.shell === "undefined") {
    options.shell = true;
  }
  if (typeof options.console === "undefined") {
    options.console = true;
  }
  const child = spawn(cmd, options);
  child.stdout.on("data", data => {
    if (options.console) {
      data
        .toString()
        .replace(/\s*$/, "")
        .split("\n")
        .forEach(ln => {
          if (options.title) {
            log(options.title, ln);
          } else {
            log(ln);
          }
        });
    }
    stream.write(data);
  });
  child.stderr.on("data", data => {
    if (options.console) {
      data
        .toString()
        .replace(/\s*$/, "")
        .split("\n")
        .forEach(ln => {
          if (options.title) {
            log(options.title, ln);
          } else {
            log(ln);
          }
        });
    }
    stream.write(data);
  });
  child.on("error", data => {
    stream.write("\n\nERROR: ");
    stream.write(data);
  });
  child.on("exit", data => {
    if (data) {
      stream.end(`\n\nEXIT ${data}`);
    } else {
      stream.end();
    }
  });
  processes.push(child);
  return stream;
};

const killAllSpawn = () => {
  processes.forEach(p => p.kill());
};

const waitPort = (port, timeout = 60) => {
  return new Promise((resolve, reject) => {
    var retry = 0;
    const test = () => {
      exec(`lsof -P -i :${port}`, (err, stdout) => {
        const lines = stdout.trim().split("\n");
        if (lines.length === 2) {
          resolve(0);
        } else if (retry++ > timeout) {
          reject(new Error(`Port not ready ${port}`));
        } else {
          setTimeout(test, 1000);
        }
      });
    };
    setTimeout(test, 1000);
  });
};

const killPort = port => {
  return new Promise((resolve, reject) => {
    exec(`lsof -P -i :${port}`, (err, stdout) => {
      const lines = stdout.trim().split("\n");
      if (lines.length === 2) {
        exec(`kill -9 ${lines[1].split(/\s+/)[1]}`, () => {
          resolve(0);
        });
      } else {
        resolve(0);
      }
    });
  });
};

gulp.spawn = spawnWrap;

module.exports = (SRC = ["**/*.ts", "!node_modules/**", "!dist/**"]) => {
  gulp.task("yarn", () => {
    return gulp
      .src(["./package.json"])
      .pipe(filterSince("./yarn.lock"))
      .pipe(yarn());
  });

  gulp.task("touch-src", ["yarn"], () => {
    return gulp
      .src(SRC, { read: false })
      .pipe(filterBefore("./yarn.lock"))
      .pipe(debug({ title: "touch-src" }))
      .pipe(touch());
  });

  gulp.task("tsc", ["yarn", "touch-src"], () => {
    return gulp
      .src(SRC, { read: false })
      .pipe(changed("dist", { extension: ".js" }))
      .pipe(debug({ title: "tsc" }))
      .pipe(tslint())
      .pipe(tslint.report())
      .pipe(typescript({ project: "." }))
      .pipe(gulp.dest("dist"))
      .pipe(debug({ title: "dest" }));
  });

  gulp.task("yarn-upgrade-git", ["yarn"], cb => {
    const deps = JSON.parse(fs.readFileSync("package.json").toString())
      .dependencies;
    const lock = yarnLock.parse(fs.readFileSync("./yarn.lock").toString())
      .object;
    async.forEachSeries(
      Object.getOwnPropertyNames(deps),
      (dk, acb) => {
        const dkv = deps[dk];
        if (dkv.indexOf("https://") >= 0) {
          const rv = lock[`${dk}@${dkv}`];
          if (rv && rv.resolved) {
            const branch = dkv.split("#")[1];
            log(`git ls-remote ${dkv.split("#")[0]}`);
            exec(
              `git ls-remote ${dkv.split("#")[0]}`,
              (err, stdout, stderr) => {
                log(stderr);
                if (!err) {
                  const ref = stdout
                    .split("\n")
                    .filter(v => v.endsWith(branch));
                  if (ref.length === 1) {
                    if (rv.resolved.endsWith(`#${ref[0].split("\t")[0]}`)) {
                      acb();
                    } else {
                      log(`yarn upgrade ${dk}`);
                      exec(`yarn upgrade ${dk}`, (err, stdout, stderr) => {
                        log(stderr);
                        log(stdout);
                        acb(err);
                      });
                    }
                  } else {
                    log(`yarn upgrade ${dk}`);
                    exec(`yarn upgrade ${dk}`, (err, stdout, stderr) => {
                      log(stderr);
                      log(stdout);
                      acb(err);
                    });
                  }
                } else {
                  acb(err);
                }
              }
            );
          } else {
            log(`yarn upgrade ${dk}`);
            exec(`yarn upgrade ${dk}`, (err, stdout, stderr) => {
              log(stderr);
              log(stdout);
              acb(err);
            });
          }
        } else {
          acb();
        }
      },
      err => {
        cb(err);
      }
    );
  });

  gulp.task("clean", cb => {
    rimraf("dist", cb);
  });

  return {
    SRC,

    gulp,
    changed,
    log,
    debug,
    yarn,
    through,
    typescript,
    tslint,
    touch,
    tap,
    filter,
    rename,
    mocha,

    filterSince,
    filterBefore,
    mtime,
    touchFile,
    spawn: spawnWrap,
    killAllSpawn,
    waitPort,
    killPort,

    moment,
    async,
    merge
  };
};