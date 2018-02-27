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
                                let params = [];

                                _.forEach(acceptingParams, (param, name) => {
                                    let loopbackParam = _.find(loopbackAcceptMethodParams, {arg: name});
                                    if (args[name] && Object.keys(args[name]).length > 0) {
                                        if (typeof args[name] === 'string') {
                                            params.push(args[name])
                                        } else {
                                            params.push(_.cloneDeep(args[name]))
                                        }
                                    } else if (loopbackParam && loopbackParam.http && loopbackParam.http.source) {
                                        // This is for custom remote methods
                                        if (context[name]) {
                                            params.push(context[name]);
                                        }
                                    }
                                });
                                // If custom remote method call, probably add better checking
                                if (method.accessType === undefined) {
                                    return promisify(model[method.name]).apply(this, params);
                                } else {
                                    let ctxOptions = { accessToken: context.req.accessToken };
                                    let wrap = promisify(model[method.name](params.length > 1 ? _.merge(...params) : params[0], ctxOptions));
                                    return typeObj.list ? connectionFromPromisedArray(wrap, args, model) : wrap;
                                }

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