# Proxy-safe private members

This proposal offers a different approach to the implementation of instance-private data in classes and objects, one that allows Proxy objects to behave normally without blocking access to private data when the Proxy handler methods are not configured as a Membrane.

## Overview

The main reason for the incompatibility between class-fields and Proxy is due to the fact that Proxy doesn't tunnel internal slots. This is already a known issue. It has been declared that any solution for this issue must be complete, in that it also solves the problem for built-in objects like Date. This proposal circumvent the issue entirely through the creation of a new exotic object stored in an immutable public property on each instance. The exotic object is designed such that it only exposes its contents to the scope of a function that is a member of the same class as the context object. Outside of this circumstance, the exotic object behaves as if it was defined as `let obj = Object.freeze({});`.

## Motivations

Today, ECMAScript developers can create private data for a class instance using WeakMap and a closure:

```js
const Ex = (function() {
  const pmap = new WeakMap;
  
  return class Ex {
    constructor() {
      pmap.set(this, { x:42 });
    }
    print() {
      let p = pmap.get(this) || {};
      console.log(`this.#x = ${p.x}`);
    }
  }
}
```

This becomes problematic when a developer wraps an instance of Ex in a Proxy. However, [as can be seen here](https://stackblitz.com/edit/js-dhethl), there is a way to get around the issue of compatibility between Proxy and WeakMap. The [proposal-class-fields](https://github.com/tc39/proposal-class-fields), currently in stage 3, proposes an ergonomic syntax  for this process. The same class can be defined as such:

```js
class Ex {
  #x = 42;
  
  print() {
    console.log(`this.#x = ${this.#x}`);
  }
}
```
However, given the current specification, the afore-mentioned work-around will no longer work. There is no feasible means of having Proxy and private fields as defined in proposal-class-fields work together without modifying the semantics of Proxy.

## Syntax

This proposal does not yet offer a unique syntax. While the author has a particular preference for his own proposal-class-members syntax, it is recognized that TC39 has settled on the class-fields syntax. Since this isn't a point of contention for this proposal, all example logic will be presented using class-fields syntax.

## Semantics

* Function Environment Records have a new field:
  > | Field Name | Value | Meaning |
  > |:-|:-|:-|
  > | \[\[ClassObject]] | Object \| **undefined** | If the associated function is a lexically defined member of a class, \[\[ClassObject]] is the constructor of the class containing the definition of this function. The default value for \[\[ClassObject]] is **undefined**. |
* ECMAScript Function Objects have 2 new internal slot:
  > | Interanl Slot | Type | Description |
  > |:-|:-|:-|
  > | \[\[ClassObject]] | Object \| **undefined** | If the function is a lexically defined member of a class, this object is assigned the constructor of that class. |
  > | \[\[Signature]] | Symbol \| **undefined** | If the function is a class constructor function, this slot is assigned a new Symbol to be used as the unique key for unlocking access to the private members of an instance of the class.|
* Symbol has a new non-configurable, non-writable property
  > | Field Name | Value | Meaning |
  > |:-|:-|:-|
  > | privateKey | Symbol() | This key is used to create a non-configurable, non-enumerable, non-writable property on the class constructor that will hold a Symbol() to be used as the unique key of the private data container.
* A new exotic object _PrivateStore_ to contain the private data
* During ClassDefinitionEvaluation, where _C_ is the class constructor
  * _C_ is assigned to the \[\[ClassObject]] of each method
  * _C_ is assigned a non-writable, non-configurable, non-enumerable property named Symbol.privateKey with a new Symbol value
  * _C_.\[\[Signature]] is assigned a new Symbol value
* During NewFunctionEnvironment, where _F_ is the function being run
  * _F_.\[\[ClassObject]] is copied from the function object to _envrec_.\[\[ClassObject]]
* During Construct, where _inst_ is the new instance object
  * _inst_\[envrec.\[\[ClassObject]]\[Symbol.privateKey]] is assigned to a new _PrivateStore_ _P_
  * Each private property of the target class is initialized onto _P_
* When getting a private property from instance _inst_ in a member function with either `inst.#field` or `inst[#'field']`
  * Let _pd_ be _inst_\[envrec.\[\[ClassObject]]\[Symbol.privateKey]]
  * Assert(_pd_)
  * return _pd_['field']
* When attempting to access a private property _field_ in any other scenario
  * return {}['field']

The _PrivateStore_ class behaves as though it was defined as such:

```js
let PrivateStore = (() => {
  return class PrivateStore {
    constructor(lock, pvt) {
      return new Proxy(pvt, new Proxy({}, {
        data: {
          defaults: { //All other defaults are false
            get: void 0,
            getPrototypeOf: null,
            getOwnPropertySymbols: [],
            getOwnPropertyDescriptor: void 0,
            isExtensible: true,
            ownKeys: [],
            apply: void 0
          },
          enabled: false
        },
        get(target, prop, receiver) {
          let dflt = (prop in this.data.defaults) ? this.data.defaults[prop] : false;
          let condition = this.data.enabled;
          let self = this;

          return function(...args) {
            let retval = dflt;
            let key = args[1];

            if ((key === lock) && (prop == "set")) {
              self.data.enabled = args[2];
              retval = true;
            }
            else {
              if (["get", "has", "set"].includes(prop))
                condition = condition || (key === lock);

              if (condition)
                retval = Reflect[prop](...args);
            }

            return retval;          
          }
        }
      }));
    }
  };
})();
```

The `lock` parameter specifies the special key that the object will use to signal the enabling and disabling of access to the stored data. By default, access to the data is disabled. The property at this key is a boolean that cannot be read but can always be written.
