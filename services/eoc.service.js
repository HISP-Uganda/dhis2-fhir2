"use strict";

const { capitalize } = require("lodash");
const { isArray } = require("lodash");
const { generateUid } = require("./uid");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "eoc",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es"],

	/**
	 * Actions
	 */
	actions: {
		program: {
			async handler(ctx) {
				const entities = await ctx.call("es.search", {
					index: "entities",
					body: { query: { match: { "type.keyword": "Person" } }, size: 1000 },
				});
				if (entities.length > 0) {
					const [entity] = entities;
					return this.getDHIS2Code(entity._source.mappings);
				}
				return null;
			},
		},
		facility: {
			async handler(ctx) {
				if (ctx.params.ref && ctx.identifier && ctx.params.identifier.value) {
					const organisationSearch = await ctx.call("es.searchById", {
						id: ctx.identifier.value,
						index: "organisations",
					});
					return this.getDHIS2Code(organisationSearch.mappings);
				} else if (ctx.params.reference) {
					const id = String(ctx.params.reference).replace("Organization/", "");
					const organisationSearch = await ctx.call("es.searchById", {
						id,
						index: "organisations",
					});
					return this.getDHIS2Code(organisationSearch.mappings);
				}
			},
		},
		current: {
			async handler(ctx) {
				const attributes = await ctx.call("es.search", {
					index: "attributes",
					body: { query: { match_all: {} }, size: 1000 },
				});
				const identifiers = this.getIdentifiers(ctx.params, attributes);
				const biodata = this.getBio(ctx.params, attributes);
				return {
					identifiers,
					biodata,
				};
			},
		},
		previous: {
			async handler(ctx) {
				if (ctx.params.id) {
					const patientSearch = await ctx.call("es.searchById", {
						id: ctx.params.id,
						index: "patients",
					});
					return patientSearch;
				} else if (ctx.params.identifiers?.length > 0) {
					const patientSearch = await ctx.call("es.searchByValues", {
						term: "attributes",
						values: ctx.params.identifiers,
						index: "patients",
					});
					return patientSearch;
				}
			},
		},
	},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {
		getDHIS2Code(mappings) {
			if (mappings !== undefined && isArray(mappings)) {
				const search = mappings.find((mapping) => mapping.system === "DHIS2");
				if (search) {
					return search.code;
				}
			}
		},
		getReference(ref) {
			if (ref && ref.identifier && ref.identifier.value) {
				return ref.identifier.value;
			} else if (ref.reference) {
				return String(ref.reference).replace("Organization/", "");
			}
		},
		searchOne(identifies, field, attribute1, attribute2, value1, value2) {
			const response = identifies.find(({ _source }) => {
				return (
					_source[field].find(
						(mapping) =>
							mapping[attribute1] === value1 && mapping[attribute2] === value2
					) !== undefined
				);
			});
			if (response) {
				const {
					_source: { mappings },
				} = response;
				return this.getDHIS2Code(mappings);
			}
			return undefined;
		},
		getIdentifiers(patient, attributes) {
			const identifiers = attributes.filter((a) => a._source.identifier);
			return patient.identifier.flatMap((currentIdentifier) => {
				if (currentIdentifier.type.coding) {
					const [{ code, system }] = currentIdentifier.type.coding;
					const attribute = this.searchOne(
						identifiers,
						"mappings",
						"code",
						"system",
						code,
						system
					);
					if (attribute) {
						return [{ attribute, value: currentIdentifier.value }];
					}
				} else if (currentIdentifier.type.text && currentIdentifier.id) {
					const system = currentIdentifier.type.text;
					const code = currentIdentifier.id;
					const attribute = this.searchOne(
						identifiers,
						"mappings",
						"code",
						"system",
						code,
						system
					);
					if (attribute) {
						return [{ attribute, value: currentIdentifier.value }];
					}
				}
				return [];
			});
		},
		searchAttribute(attributes, type, value) {
			const attribute = attributes.find(({ _source }) => {
				return _source[type] === value;
			});
			if (attribute) {
				return this.getDHIS2Code(attribute._source.mappings);
			}
			return null;
		},

		getBio(patient, attributes) {
			const obj = {
				birthDate: patient.birthDate,
				given:
					patient.name.length > 0
						? [patient.name[0].family, ...patient.name[0].given].join(" ")
						: "",
				gender: capitalize(patient.gender),
				telecom: patient.address.length > 0 ? patient.address[0].text : "",
				address: patient.address.length > 0 ? patient.address[0].text : "",
				maritalStatus: patient.maritalStatus?.text,
			};
			return [
				"birthDate",
				"maritalStatus",
				"given",
				"gender",
				"telecom",
				"address",
				"maritalStatus",
			].flatMap((a) => {
				const attribute = this.searchAttribute(attributes, "type", a);
				const value = obj[a];
				if (attribute && value) {
					return [{ attribute, value }];
				}
				return [];
			});
		},
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {},
};
