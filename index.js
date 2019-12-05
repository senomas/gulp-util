const fs = require("fs");
const path = require("path");
const netstat = require("node-netstat");
const { spawn, exec } = require("child_process");
const log = require("fancy-log");
const yarnLock = require("yarn-lockfile");
const gst = require("git-state");

const gitCheck = async path => {
  fs.readdirSync(path).forEach(f => {
    const fn = `${path}/${f}`;
    if (
      !f.startsWith(".") &&
      fs.lstatSync(fn).isDirectory() &&
      gst.isGitSync(fn)
    ) {
      const gc = gst.checkSync(fn);
      if (gc.ahead) {
        if (gc.dirty) {
          if (gc.untracked) {
            console.log(
              `${f}#${gc.branch}: AHEAD ${gc.ahead} DIRTY ${
                gc.dirty
              } UNTRACKED ${gc.untracked}`
            );
          } else {
            console.log(
              `${f}#${gc.branch}: AHEAD ${gc.ahead} DIRTY ${gc.dirty}`
            );
          }
        } else {
          if (gc.untracked) {
            console.log(
              `${f}#${gc.branch}: AHEAD ${gc.ahead} UNTRACKED ${gc.untracked}`
            );
          } else {
            console.log(`${f}#${gc.branch}: AHEAD ${gc.ahead}`);
          }
        }
      } else if (gc.dirty) {
        if (gc.untracked) {
          console.log(
            `${f}#${gc.branch}: DIRTY ${gc.dirty} UNTRACKED ${gc.untracked}`
          );
        } else {
          console.log(`${f}#${gc.branch}: DIRTY ${gc.dirty}`);
        }
      } else {
        console.log(`${f}#${gc.branch}: clean`);
      }
    }
  });
};

const execSync = async (cmd, options = {}) => {
  log(`EXEC[${path.resolve(".")}]:`, cmd);
  if (options.maxBuffer === undefined) {
    options.maxBuffer = 1024 * 500;
  }
  return new Promise((resolve, reject) => {
    exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      resolve(stdout + stderr);
    });
  });
};

const spawnSync = async (cmd, options = {}) => {
  log(`SPAWN[${path.resolve(options.cwd || ".")}]:`, cmd);
  if (options.shell === undefined) {
    options.shell = true;
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, options);
    proc.on("error", err => {
      return reject(err);
    });
    let printData;
    let fout;
    if (options.log) {
      fout = fs.createWriteStream(options.log);
      if (options.console) {
        printData = data => {
          const ds = data.toString();
          ds.replace(/\s*$/, "")
            .split("\n")
            .forEach(ln => {
              log(ln);
            });
          fout.write(ds);
        };
      } else {
        printData = data => {
          fout.write(data.toString());
        };
      }
      delete options.console;
    } else {
      printData = data => {
        data
          .toString()
          .replace(/\s*$/, "")
          .split("\n")
          .forEach(ln => {
            log(ln);
          });
      };
    }
    proc.stdout.on("data", data => {
      printData(data);
    });
    proc.stderr.on("data", data => {
      printData(data);
    });
    proc.on("exit", code => {
      if (fout) {
        fout.close();
      }
      if (code && code !== 0) {
        return reject(
          new Error(
            `SPAWN[${path.resolve(options.cwd || ".")}] ${cmd}: Exit ${code}`
          )
        );
      }
      resolve();
    });
  });
};

const checkPorts = ports => {
  const lports = [];
  netstat(
    { sync: true, filter: { state: "LISTENING" } },
    data => {
      if (data.local.port && (protocol === "tcp" || protocol === "tcp6")) {
        lports.push(data.local.port);
      }
    }
  );
  for (const port of ports) {
    if (lports.indexOf(port) < 0) {
      return false;
    }
  }
  return true;
};

const waitPort = (port, timeout = 60, name = "") => {
  return new Promise((resolve, reject) => {
    var retry = 0;
    const test = () => {
      const lports = [];
      netstat(
        { sync: true, filter: { state: "LISTENING" } },
        data => {
          if (data.local.port && (protocol === "tcp" || protocol === "tcp6")) {
            lports.push(data.local.port);
          }
        }
      );
      if (lports.indexOf(port) >= 0) {
        resolve(true);
      } else if (retry++ > timeout) {
        reject(new Error(`Port not ready ${port} ${name}`));
      } else {
        setTimeout(test, 1000);
      }
    };
    setTimeout(test, 1000);
  });
};

const yarnUpgradeGit = async () => {
  const deps = JSON.parse(fs.readFileSync("package.json").toString())
    .dependencies;
  const lock = yarnLock.parse(fs.readFileSync("./yarn.lock").toString()).object;
  const depsa = Object.keys(deps);
  for (let i = 0, il = depsa.length; i < il; i++) {
    const dk = depsa[i];
    const dkv = deps[dk];
    if (dkv.indexOf("https://") >= 0) {
      const rv = lock[`${dk}@${dkv}`];
      if (rv && rv.resolved) {
        const branch = dkv.split("#")[1];
        log(`git ls-remote ${dkv.split("#")[0]}`);
        const gls = await execSync(`git ls-remote ${dkv.split("#")[0]}`);
        const ref = gls.split("\n").filter(v => v.endsWith(branch));
        if (ref.length === 1) {
          if (rv.resolved.endsWith(`#${ref[0].split("\t")[0]}`)) {
            // skip
          } else {
            await execSync(`yarn add ${dkv}`);
          }
        } else {
          await execSync(`yarn add ${dkv}`);
        }
      } else {
        await execSync(`yarn add ${dkv}`);
      }
    }
  }
};

module.exports = {
  gitCheck,
  execSync,
  spawnSync,
  checkPorts,
  waitPort,
  yarnUpgradeGit
};
