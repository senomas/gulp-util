const yargs = require("yargs");

const gulp = require("gulp");
const { exec } = require("child_process");

gulp.task("bump", cb => {
  const msg = yargs.argv.m;
  if (!msg) throw new Error("no -m");
  exec("npm version patch", (err, stdout) => {
    if (err) {
      return cb(err);
    }
    console.log(stdout);
    cb();
  });
});

gulp.task("default", ["bump"], cb => {
  const msg = yargs.argv.m;
  if (!msg) throw new Error("no -m");
  exec("npm publish", (err, stdout) => {
    if (err) {
      return cb(err);
    }
    console.log(stdout);
    cb();
  });
});
