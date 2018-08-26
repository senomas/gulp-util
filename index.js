const fs = require("fs");
const { spawn, exec } = require("child_process");
const log = require("fancy-log");
const glob = require('glob');
const yarnLock = require("yarn-lockfile");

const execSync = async(cmd) => {
  log("EXEC:", cmd);
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      resolve(stdout + stderr);
    });
  });
}

const spawnSync = async(cmd, options = {}) => {
  log("SPAWN:", cmd);
  if (options.shell === undefined) {
    options.shell = true;
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, options);
    proc.on("error", err => {
      return reject(err)
    });
    let printData;
    let fout;
    if (options.log) {
      fout = fs.createWriteStream(options.log);
      printData = (data) => {
        fout.write(data.toString());
      }
    }
    else {
      printData = (data) => {
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
    proc.on("exit", () => {
      if (fout) {
        fout.close();
      }
      resolve()
    });
  });
}

const waitPort = (port, timeout = 60) => {
  return new Promise((resolve, reject) => {
    var retry = 0;
    const test = () => {
      exec("netstat -an --tcp", (err, stdout) => {
        if (err) {
          return reject(err);
        }
        const lines = stdout
          .trim()
          .split("\n")
          .map(ln => ln.split(new RegExp("\\s+")))
          .slice(2)
          .filter(v => v[3].endsWith(`:${port}`));
        if (lines.length > 0) {
          resolve(0);
        }
        else if (retry++ > timeout) {
          reject(new Error(`Port not ready ${port}`));
        }
        else {
          setTimeout(test, 1000);
        }
      });
    };
    setTimeout(test, 1000);
  });
};

const yarnUpgradeGit = async() => {
  const deps = JSON.parse(fs.readFileSync("package.json").toString())
    .dependencies;
  const lock = yarnLock.parse(fs.readFileSync("./yarn.lock").toString())
    .object;
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
          }
          else {
            await execSync(`yarn upgrade ${dk}`);
          }
        }
        else {
          await execSync(`yarn upgrade ${dk}`);
        }
      }
      else {
        await execSync(`yarn upgrade ${dk}`);
      }
    }
  }
}

module.exports = { execSync, spawnSync, waitPort, yarnUpgradeGit };
