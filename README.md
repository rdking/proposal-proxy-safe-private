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
  * Let _cls_ be _envrec_.\[\[ClassObject]]
  * Let _sig_ be _cls_.\[\[Signature]]
  * Let _key_ be _cls_\[Symbol.privateKey]
  * Let _pd_ be _inst_\[_key_]
  * _pd_ is assigned to the return value of new _PrivateStore_(_key_, {})
  * Each private property of the target class is initialized onto _pd_
* When getting a private property from instance _inst_ in a member function with either `inst.#field` or `inst[#'field']`
  * Let _cls_ be _envrec_.\[\[ClassObject]]
  * Let _sig_ be _envrec_.\[\[Signature]]
  * Let _key_ be _cls_\[Symbol.privateKey]
  * Let _pd_ be _inst_\[_key_]
  * Assert(_pd_)
  * Assign true to _pd_[_sig_]
  * Let _rval_ be _pd_['field']
  * Assign false to _pd_[_sig_]
  * Return _rval_
* When setting a private property from instance _inst_ in a member function with either `inst.#field = val` or `inst[#'field']`
  * Let _cls_ be _envrec_.\[\[ClassObject]]
  * Let _sig_ be _envrec_.\[\[Signature]]
  * Let _key_ be _cls_\[Symbol.privateKey]
  * Let _pd_ be _inst_\[_key_]
  * Assert(_pd_)
  * Assign true to _pd_[_sig_]
  * Assign _val_ to _pd_['field']
  * Assign false to _pd_[_sig_]
* When attempting to access a private property _field_ from _inst_ in any other scenario
  * Lat _access_ be the invariant being called
  * Return Reflect[_access_]({}, 'field', ...)

The _PrivateStore_ class behaves as though it was defined as such:

```js
let PrivateStore = (() => {
  return class PrivateStore {
    constructor(lock, pvt = {}) {
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

The `pvt` parameter specifies an object that either contains or will contain the initialization data. If the initialization process is separate from the creation of the PrivateStore, then this parameter is optional. The use of this parameter is dependent on the engine developer's design.

## Behavior
The behavior of a PrivateStore is such that except where explicitly defined to be otherwise, it behaves as a sealed ECMAScript Object with no properties and a null prototype. When a lexically defined class member function is run and that class defines private fields, an attempt to access a private field results in the following actions:

* If the requested operation is not "get" and not "set", a TypeError is thrown.
* The class that defined the function is retrieved from the functions Environment Record.
* The class signature is retrieved from the class.
* The PrivateStore key is retrieved from the class.
* The PrivateStore key is used to retrieve the PrivateStore from the instance.
* If the PrivateStore does not exist, a TypeError is thrown.
* The class signature is used to unlock the PrivateStore.
* If the unlock attempt fails, a TypeError is thrown.
* The operation is completed normally with the PrivateStore as the target.
* The class signature is used to lock the PrivateStore.
* The return value of the requested operation is returned.

During initialization of the PrivateStore, only the "defineProperty" operation is valid. The PrivateStore is unlocked at the beginning of the initialization and locked as the final step after all private member initializations are complete.

#### Notes:
* Since this process does not make use of instance internal slots, and internal slots on a constructor are not affected during construction even if the constructor is wrapped in a Proxy, this particular approach to handling private members results in fully encapsulated private data that does not rely on the identity of the owning instance, and therefore does not automatically preclude the use of Proxy in conjunction.
* Though not part of this proposal, use of the PrivateStore exotic object may lead to an approach for allowing object literals to contain private members.
* Since an instance's PrivateStore can only be unlocked inside of a function defined by a class that "constructed" the instance, it is not possible to accidentally unlock the PrivateStore.
* Since each participating class defines its own PrivateStore, it is expected that an instance may have more than 1 PrivateStore. Each participating class' methods will only be able to access the PrivateStore it defined.
* Since an instance may have more than 1 PrivateStore, a future proposal can be crafted to allow for "protected" support via a shared signature, privateKey, and PrivateStore. That is not part of this proposal.
* Since the private store is neither configurable nor writable, it is not possible for a Proxy to replace the private store.

## Examples:

Because this is a change to internal behavior with no discernable changes to the enabling syntax, there are no code examples I can reasonably place in this README.md. However, the [example](/example) folder in this repo contains a fully functional implementation of the logic proposed. Barring a few differences, like the substitution of `$` for `#` (since class-fields support is required and the behavior of `#` is what this proposal seeks to remedy), this example should serve as a reasonable tool for helping to understand the potentially vague descriptions above.