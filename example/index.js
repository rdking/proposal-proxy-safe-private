let Class = require("./lib/Class");

/**
 * The code below is an example of the behavior behind 
 * proposal-proxy-safe-private. To understand it, just presume that `$` is a
 * stand-in for `#` in class fields. The `Class` wrapper library does the
 * heavy lifting required to make the private behavior work. No monkey-patching
 * or Proxy modification required.
 * 
 * Running this code requires a version of NodeJS that supports class-fields.
 */
const Test = Class(class Test {
  $data = 42;
  print() {
    console.log(`From inside of instance: this.$data = ${this.$data}`);
  }
});

let test = new Test;
console.log(`Using an unwrapped instance.`);
console.log(`From outside of instance: test.$data = ${test.$data}`);
test.print();

let ptest = new Proxy(test, {});
console.log(`Using a Proxy wrapped instance.`);
console.log(`From outside of instance: test.$data = ${test.$data}`);
test.print();

//debugger;
const SubTest = Class(class SubTest extends Test {
  $data = Math.PI;
  print() {
    console.log("From SubTest...");
    console.log(`From inside of instance: this.$data = ${this.$data}`);
    console.log("From Test...");
    super.print();
  }
});

let subTest = new SubTest;
subTest.print();