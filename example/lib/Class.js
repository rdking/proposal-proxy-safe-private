/**
 * Class.js is the distillation of my ideas on how to implement private data in
 * ES 6 environments. This will be the 4th major distillation, each representing
 * a different idea on how to accomplish the goal. This time, it's based on the
 * idea of creating an exotic object that is a normal property of the instance.
 */

const PrivateStore = require("./PrivateStore");

if (!("privateKey" in Symbol)) {
  Object.defineProperties(Symbol, {
    privateKey: {
      enumerable: true,
      value: Symbol("Symbol.privateKey")
    },
    protectedKey: {
      enumerable: true,
      value: Symbol("Symbol.protectedKey")
    },
    classObject: {
      enumerable: true,
      value: Symbol("Symbol.classObject")
    }
  });
}

function getCleanStack(offset = 0) {
  let limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;

  let retval = Error().stack.split('\n');
  while (!retval[0].includes("getCleanStack"))
    retval.shift();

  Error.stackTraceLimit = limit;

  return retval.slice(1 + offset);
}

const Class = (() => {
  const ClassSignature = Symbol();
  const signatures = new WeakMap;
  const frames = new WeakMap;
  const wrapMap = new WeakMap;
  const callStack = [];
  const ctorStack = [];

  /**
   * Wraps a function with a wrapper that captures the call stack
   * so that this call to a member function can be authorized from
   * private access.
   * @param {function} fn - The target function to be wrapped.
   * @param {boolean} construct - If true, fn is called using `new`.
   * @returns A wrapped version of the original function.
   */
  function getWrapper(fn, construct) {
    let retval = function(...args) {
      frames.set(fn, getCleanStack(1))
      callStack.push(fn);
      let retval = (construct) ? Reflect.construct(fn, args, new.target)
                               : fn.call(this, ...args);
      callStack.pop();
      frames.delete(fn);
      return retval;
    }

    if (construct) {
      wrapMap.set(retval, fn);
    }

    //Mask the wrapper function to look like the original.
    Object.defineProperties(retval, {
      toString: {
        enumerable: true,
        writable: true,
        value: () => fn.toString()
      },
      name: {
        configurable: true,
        value: fn.name
      },
      length: {
        configurable: true,
        value: fn.length
      }
    });
    retval.prototype = fn.prototype;
    Object.setPrototypeOf(retval, Object.getPrototypeOf(fn));
    return retval;
  }

  /**
   * Compares the current stack trace to the stack trace for the 
   * most recently called Class-managed class member function.
   * @returns A boolean specifying whether or not the test passed.
   */
  function testStack() {
    let stack = getCleanStack(4);
    let fn = callStack[callStack.length - 1];
    let stack2 = frames.get(fn);
    return !!stack2 && (stack2.join('\n') == stack.join('\n'));
  }

  function Class(clazz) {
    if (this instanceof Class)
      throw new TypeError("Class is not a constructor.");
    if (typeof(clazz) != "function")
      throw new TypeError("Class requires a constructor function as a parameter");
    if (clazz.hasOwnProperty(Symbol.privateKey))
      throw new TypeError("The constructor function already has a private key!");

    /**
     * This code substitutes for ClassDefinitionEvaluation. Start by
     * generating the privateKey and class signature.
     */
    Object.defineProperties(clazz, {
      [Symbol.privateKey]: {
        value: Symbol(`${clazz.name} Private Key`)
      },
      [Symbol.protectedKey]: {
        value: Symbol(`${clazz.name} Protected Key`)
      }
    });
    signatures.set(clazz, Symbol(`${clazz.name} Signature`));

    /**
     * Wrap all the member and static member functions, and stamp them
     * with the identity for the class. We'll be using that later to
     * verify permissions and access the correct PrivateStore.
     */
    for (let obj of [clazz.prototype, clazz]) {
      let keys = Object.getOwnPropertyNames(obj)
                .concat(Object.getOwnPropertySymbols(obj))
                .filter(name => (name == "constructor") || 
                        (!Function.prototype.hasOwnProperty(name) &&
                         (name != Symbol.classObject)));
      for (let key of keys) {
        let desc = Object.getOwnPropertyDescriptor(obj, key);
        if (desc) {
          for (let prop of ["value", "get", "set"]) {
            if ((prop in desc) && (typeof(desc[prop]) == "function")) {
              //Stamp the class identitiy on the function.
              Object.defineProperty(desc[prop], Symbol.classObject, {
                value: clazz
              });
              //Wrap the function so we can authorize access for it as needed.
              desc[prop] = getWrapper(desc[prop], key == "constructor");
              Object.defineProperty(obj, key, desc);
            }
          }
        }
      }
    }

    const pHandler = new Proxy({}, {
      get(t, handler, r) {
        return (...args) => {
          let [target, prop] = args;
          let retval, clazz;
          let constructing = ctorStack.length > 0;

          if ((handler == "has") && (prop === ClassSignature)) {
            retval = true;
          }
          else if (!constructing && prop && (typeof(prop) == "string") 
                    && prop.length && (prop[0] == '$')) {
            //This is an access attempt on a private member!
            if (handler == "get")
              retval = void 0;
              else
              retval = false;
              
            /**
             * This is the ES equivalent of getting the [[ClassObject]] from
             * the environment record. Clumbsy though it may be, it should
             * work on any platform.
             */
            if (testStack()) {
              clazz = callStack[callStack.length - 1][Symbol.classObject];
            }

            if (typeof(clazz) == "function") {
              let pvt = target[clazz[Symbol.privateKey]];
              let sig = signatures.get(clazz);

              if (!pvt || !sig) {
                throw new TypeError("Unsigned class encountered.");
              }
              if (["defineProperty", "deleteProperty", "has"].includes(handler)) {
                throw new TypeError(`Attempted "${handler}" on a private field.`);
              }

              console.log(`handler = "${handler}"`);
              args[0] = pvt;
              args[1] = prop.substring(1);
              pvt[sig] = true;
              retval = Reflect[handler](...args);
              pvt[sig] = false;
            }
          }
          else {
            retval = Reflect[handler](...args);
          }

          return retval;
        }
      }
    });

    let ctor = clazz.prototype.constructor || getWrapper(clazz, true);

    /**
     * Last step. To make this somewhat ergonomic, were going to hijack
     * `$` to mean "private" when it's the first characterof the name. it
     * could just as easily be `_`, but that's already being used publicly. 
     */
    return new Proxy(ctor, {
      filter(obj, keys) {
        let retval = {};
        for (let key of keys) {
          Object.defineProperty(retval, key.substring(1), Object.getOwnPropertyDescriptor(obj, key));
          delete obj[key];          
        }
        return retval;
      },
      construct(target, args, newTarget, context) {
        let pvtKey = clazz[Symbol.privateKey];
        let protKey = clazz[Symbol.protectedKey];
        let sig = signatures.get(clazz);
        if (!pvtKey || !protKey || !sig) {
          throw new TypeError("Unsigned class encountered in the inheritance chain.");
        }

        let rval;
        ctorStack.push(clazz);
        if (context) {
          rval = Reflect.apply(target, context, args);
          rval = rval || context;
        }
        else {
          rval = Reflect.construct(target, args, newTarget);
        }
        
        let members = Object.getOwnPropertyNames(rval);
        let pvtMembers = members.filter(key => key[0] == '$');
        let protMembers = members.filter(key => key[0] == '_');
        
        let pvtInit = this.filter(rval, pvtMembers);
        let protInit = this.filter(rval, protMembers);
        
        Object.defineProperties(rval, {
          [pvtKey]: {
            value: new PrivateStore(sig, pvtInit)
          },
          [protKey]: {
            value: new PrivateStore(sig, protInit)
          }
        });
        ctorStack.pop();

        return new Proxy(rval, pHandler);
      },
      apply(target, context, args) {
        let retval;
        if ([target, wrapMap.get(target)].includes(clazz)) {
          retval = this.construct(target, args, target, context);
        }
        else {
          retval = Reflect.apply(target, context, args);
        }

        return retval;
      }
    });
  }

  return Class;
})();

module.exports = Class;
