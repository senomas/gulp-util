const gulp = require("gulp");
const promisify = require("gulp-promisify");
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
const ssh = require("gulp-ssh");
const insert = require("gulp-insert");

const fs = require("fs");
const { exec, spawn } = require("child_process");
const rimraf = require("rimraf");
const moment = require("moment");
const yarnLock = require("yarn-lockfile");
const async = require("async");
const merge = require("merge-stream");
const source = require("vinyl-source-stream");

promisify(gulp);

const spawned = [];

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
  if (!options.appendLog) {
    fs.writeFileSync(options.log || "spawn.log", "");
  }
  const stream = source(options.log || "spawn.log");
  if (typeof options.shell === "undefined") {
    options.shell = true;
  }
  if (typeof options.console === "undefined") {
    options.console = true;
  }
  if (options.title) {
    log(options.title, cmd);
  } else {
    log(cmd);
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
    stream.emit("error", data);
  });
  child.on("exit", data => {
    if (data) {
      log(`${options.cwd || path.resolve(".")} Exit with return code`, data);
      stream.end(`\n\nEXIT ${data}`);
      stream.emit(
        "error",
        new Error(
          `${options.cwd || path.resolve(".")} Exit with return code ${data}`
        )
      );
    } else {
      stream.end();
    }
  });
  spawned.push(child);
  return stream;
};

const killAllSpawn = () => {
  spawned.forEach(p => p.kill());
};

const waitPort = (port, timeout = 60) => {
  return new Promise((resolve, reject) => {
    var retry = 0;
    const test = () => {
      exec("netstat -an --tcp", (err, stdout) => {
        const lines = stdout
          .trim()
          .split("\n")
          .map(ln => ln.split(new RegExp("\\s+")))
          .slice(2)
          .filter(v => v[3].endsWith(`:${port}`));
        log(`RESULT ${JSON.stringify(lines, undefined, 2)}`);
        if (lines.length > 0) {
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

module.exports = (SRC = ["**/*.ts", "!node_modules/**", "!dist/**"]) => {
  gulp.task("yarn", () => {
    return gulp
      .src(["./package.json"])
      .pipe(filterSince("./yarn.lock"))
      .pipe(yarn())
      .pipe(debug({ title: "YARN" }));
  });

  gulp.task("touch-src", ["yarn"], () => {
    return gulp
      .src(SRC, { read: false })
      .pipe(filterBefore("./yarn.lock"))
      .pipe(debug({ title: "touch-src" }))
      .pipe(touch());
  });

  gulp.task("pre-tsc");

  gulp.task("tsc", ["yarn", "touch-src", "pre-tsc"], () => {
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
    spawned,

    gulp: Object.assign(gulp, { spawn: spawnWrap }),
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
    ssh,
    insert,

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
