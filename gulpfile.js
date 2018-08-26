const gulp = require("gulp");
const { exec } = require("child_process");

gulp.task("bump", cb => {
  exec("npm version patch", (err, stdout) => {
    if (err) {
      return cb(err);
    }
    console.log(stdout);
    cb();
  });
});

gulp.task("default", ["bump"], cb => {
  exec("git log --pretty=oneline --abbrev-commit -n 1", (err, stdout) => {
    if (err) {
      return cb(err);
    }
    exec("npm publish", (err, stdout) => {
      if (err) {
        return cb(err);
      }
      console.log(stdout);
      cb();
    });
  });
});
