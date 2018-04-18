'use strict';

const _ = require('lodash');

const {
    mutationWithClientMutationId,
    connectionFromPromisedArray
} = require('graphql-relay');

const promisify = require('promisify-node');

const utils = require('../utils');
const checkAccess = require("../ACLs");

const allowedVerbs = ['post', 'del', 'put', 'patch', 'all'];

module.exports = function getRemoteMethodMutations(model) {
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

                hooks[hookName] = mutationWithClientMutationId({
                    name: hookName,
                    description: method.description,
                    meta: { relation: true },
                    inputFields: acceptingParams,
                    outputFields: {
                        obj: {
                            type: typeObj.type,
                            resolve: o => o
                        },
                    },
                    mutateAndGetPayload: (args, context) => {

                        let modelId = args && args.id;
                        return checkAccess({
                            accessToken: context.req.accessToken, model: model, method: method, id: modelId })
                            .then(() => {
                                // probably add better checking
                                let isCustomMethod = method.accessType === undefined;

                                let ctxOptions = { accessToken: context.req.accessToken };
                                let localContext = {...context}
                                localContext.options = ctxOptions

                                let params = utils.getLoopbackMethodParams(acceptingParams, loopbackAcceptMethodParams, args, localContext, isCustomMethod);
                                let isLogin = model.modelName === "Account" && method.name === "login";

                                // If custom remote method call, probably add better checking
                                if (isCustomMethod && !isLogin) {
                                    return promisify(model[method.name]).apply(this, params);
                                } else {
                                    // TODO: better implemention of exluding it
                                    ctxOptions = isLogin ? "" : {accessToken: context.req.accessToken};
                                    let wrap = promisify(model[method.name](...params, ctxOptions));
                                    return typeObj.list ? connectionFromPromisedArray(wrap, args, model) : wrap;
                                }

                            })
                            .catch((err) => {
                                throw err;
                            });
                    }
                });
            }
        });
    }

    return hooks;
};
