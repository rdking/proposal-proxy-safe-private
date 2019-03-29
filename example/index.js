let Class = require("./lib/Class");

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

debugger;
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