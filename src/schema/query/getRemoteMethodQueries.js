'use strict';

const _ = require('lodash');

const promisify = require('promisify-node');
const checkAccess = require('../ACLs');

const utils = require('../utils');
const db = require('../../db');
const { connectionFromPromisedArray } = require('graphql-relay');
const allowedVerbs = ['get', 'head'];

module.exports = function getRemoteMethodQueries(model, options) {
    const hooks = {};

    if (model.sharedClass && model.sharedClass.methods) {
        model.sharedClass.methods().forEach((method) => {
            if (method.name.indexOf('Stream') === -1 && method.name.indexOf('invoke') === -1) {

                if (!utils.isRemoteMethodAllowed(method, allowedVerbs)) {
                    return;
                }

                // TODO: Add support for static methods
                if (method.isStatic === false) {
                    return;
                }

                const typeObj = utils.getRemoteMethodOutput(method);
                const acceptingParams = utils.getRemoteMethodInput(method, typeObj.list);
                const loopbackAcceptMethodParams = method.accepts;
                const hookName = utils.getRemoteMethodQueryName(model, method);
                hooks[hookName] = {
                    name: hookName,
                    description: method.description,
                    meta: { relation: true },
                    args: acceptingParams,
                    type: typeObj.type,
                    resolve: (__, args, context, info) => {
                        let modelId = args && args.id;
                        return checkAccess({
                            accessToken: context.req.accessToken,
                            model: model,
                            method: method,
                            id: modelId,
                            ctx: context,
                            options: options
                        })
                            .then(() => {
                                // probably add better checking
                                let isCustomMethod = method.accessType === undefined;

                                let ctxOptions = { accessToken: context.req.accessToken };
                                let localContext = {...context}
                                localContext.options = ctxOptions
                                
                                let params = utils.getLoopbackMethodParams(acceptingParams, loopbackAcceptMethodParams, args, localContext, isCustomMethod)
                                
                                let wrap = isCustomMethod ? promisify(model[method.name](...params)) : promisify(model[method.name](params.length > 1 ? _.merge(...params) : params[0], ctxOptions));
                             
                                return typeObj.list ? connectionFromPromisedArray(wrap, args, model) : wrap;
                               
                            })
                            .catch((err) => {
                                throw err;
                            });
                    }
                };
            }
        });
    }

    return hooks;
};
