"use strict";

const console = require("console");
const { capitalize } = require("lodash");
const { isArray } = require("lodash");
const { generateUid } = require("./uid");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "utils",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2"],

	/**
	 * Actions
	 */
	actions: {
		Patient: {
			async handler(ctx) {
				const {
					Patient: {
						birthDate,
						id: patientId,
						name,
						gender,
						telecom,
						address,
						identifier,
						maritalStatus,
						managingOrganization,
					},
				} = ctx.params;
				const entities = await ctx.call("es.search", {
					index: "entities",
					body: { query: { match: { "type.keyword": "Person" } }, size: 1000 },
				});
				const refOrganisation = this.getReference(managingOrganization);
				if (refOrganisation) {
					const organisationSearch = await ctx.call("es.searchById", {
						id: refOrganisation,
						index: "organisations",
					});
					const orgUnit = this.getDHIS2Code(organisationSearch.mappings);
					if (orgUnit) {
						if (entities.length > 0) {
							const [entity] = entities;
							const trackedEntityType = this.getDHIS2Code(
								entity._source.mappings
							);
							const esAttributes = await ctx.call("es.search", {
								index: "attributes",
								body: { query: { match_all: {} }, size: 1000 },
							});
							const identifiers = esAttributes.filter(
								(a) => a._source.identifier
							);

							if (identifiers.length > 0 && trackedEntityType !== undefined) {
								const extensions = esAttributes.filter(
									(a) => a._source.type === "extension"
								);
								let trackedEntityInstance = { trackedEntityType, orgUnit };
								let attributes = [];
								let patientIdentifiers = [];
								identifier.forEach((currentIdentifier) => {
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
											attributes = [
												...attributes,
												{ attribute, value: currentIdentifier.value },
											];
											patientIdentifiers = [
												...patientIdentifiers,
												currentIdentifier.value,
											];
										}
									} else if (
										currentIdentifier.type.text &&
										currentIdentifier.id
									) {
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
											attributes = [
												...attributes,
												{ attribute, value: currentIdentifier.value },
											];
											patientIdentifiers = [
												...patientIdentifiers,
												currentIdentifier.value,
											];
										}
									}
								});

								if (patientIdentifiers.length > 0 || patientId) {
									if (birthDate) {
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"birthDate"
										);
										if (attribute) {
											attributes = [
												...attributes,
												{ attribute, value: birthDate },
											];
										}
									}

									if (name && name.length > 0) {
										const [{ family, given }] = name;
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"given"
										);

										if (attribute) {
											attributes = [
												...attributes,
												{ attribute, value: family + " " + given.join(" ") },
											];
										}
									}

									if (gender) {
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"gender"
										);
										if (attribute) {
											attributes = [
												...attributes,
												{ attribute, value: capitalize(gender) },
											];
										}
									}

									if (telecom && telecom.length > 0) {
										const [{ value }] = telecom;
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"telecom"
										);
										if (attribute) {
											attributes = [...attributes, { attribute, value }];
										}
									}

									if (address && address.length > 0) {
										const [{ text }] = address;
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"address"
										);
										if (attribute) {
											attributes = [...attributes, { attribute, value: text }];
										}
									}
									if (maritalStatus && maritalStatus.length > 0) {
										const [{ text }] = address;
										const attribute = this.searchAttribute(
											esAttributes,
											"type",
											"maritalStatus"
										);
										if (attribute) {
											attributes = [...attributes, { attribute, value: text }];
										}
									}
									trackedEntityInstance = {
										...trackedEntityInstance,
										attributes,
									};
									const patientSearch = await ctx.call("es.searchByValues", {
										term: "attributes",
										values: patientIdentifiers,
										index: "patients",
									});
									let response;
									let toBeIndexed = {
										attributes: patientIdentifiers,
										enrollments: [],
										encounters: [],
									};

									if (patientId) {
										toBeIndexed = { ...toBeIndexed, id: patientId };
									}

									if (patientSearch) {
										toBeIndexed = {
											...toBeIndexed,
											attributes: patientIdentifiers,
										};
										trackedEntityInstance = {
											...trackedEntityInstance,
											trackedEntityInstance:
												patientSearch.trackedEntityInstance,
										};
									} else {
										const code = generateUid();
										trackedEntityInstance = {
											...trackedEntityInstance,
											trackedEntityInstance: code,
										};
										toBeIndexed = {
											...toBeIndexed,
											trackedEntityInstance: code,
										};
									}
									try {
										response = await ctx.call("dhis2.post", {
											url: "trackedEntityInstances",
											...trackedEntityInstance,
										});
										await ctx.call("es.bulk", {
											index: "patients",
											dataset: [toBeIndexed],
											id: "trackedEntityInstance",
										});
									} catch (error) {
										response = error;
									}
									return response;
								}
							}
						}
					}
				} else {
					return "Managing organisation missing or identifier of managing organisation missing";
				}
			},
		},
		EpisodeOfCare: {
			async handler(ctx) {
				try {
					const {
						EpisodeOfCare: {
							id,
							type: [
								{
									coding: [{ system, code, display }],
								},
							],
							period: { start },
							patient: { identifier, reference: patientReference },
							managingOrganization: {
								identifier: { system: ouSystem, value: ou },
							},
						},
					} = ctx.params;
					const programSearch = await ctx.call("es.searchBySystemAndCode", {
						system: system || display,
						value: code,
						index: "programs",
					});
					if (programSearch) {
						const program = this.getDHIS2Code(programSearch);
						let patientSearch;
						if (identifier) {
							patientSearch = await ctx.call("es.searchByValues", {
								term: "attributes",
								values: [identifier.value],
								index: "patients",
							});
						} else if (patientReference) {
							const [resourceType, id] = String(patientReference).split("/");
							patientSearch = await ctx.call("es.searchById", {
								index: "patients",
								id,
							});
						}

						if (patientSearch) {
							const { enrollments, trackedEntityInstance } = patientSearch;
							const organisationSearch = await ctx.call(
								"es.searchBySystemAndCode",
								{ system: ouSystem, value: ou, index: "organisations" }
							);
							const orgUnit = this.getDHIS2Code(organisationSearch);
							if (orgUnit) {
								const previousEnrollment = enrollments.find((e) => {
									return (e.enrollmentDate =
										start &&
										e.program === program &&
										e.orgUnit === orgUnit &&
										e.id === id);
								});
								if (!previousEnrollment) {
									const enrollment = generateUid();
									const enroll = {
										enrollment,
										enrollmentDate: start,
										incidentDate: start,
										orgUnit,
										trackedEntityInstance,
										program,
									};
									const response = await ctx.call("dhis2.post", {
										url: "enrollments",
										...enroll,
									});
									await ctx.call("es.bulk", {
										index: "patients",
										dataset: [
											{
												...patientSearch,
												enrollments: [...enrollments, { ...enroll, id }],
											},
										],
										id: "trackedEntityInstance",
									});
									return response;
								} else {
									return { message: "Duplicate enrollment" };
								}
							} else {
								return { message: "No organisation " };
							}
						}
					}
					return programSearch;
				} catch (error) {
					return error;
				}
			},
		},
		Encounter: {
			async handler(ctx) {
				try {
					const {
						Encounter: {
							id,
							type: [
								{
									coding: [{ system, code }],
								},
							],
							period: { start },
							subject,
							serviceProvider,
							episodeOfCare,
						},
					} = ctx.params;
					let encounterSearch = await ctx.call("es.searchBySystemAndCode", {
						system,
						value: code,
						index: "stages",
					});

					if (encounterSearch) {
						const programStage = this.getDHIS2Code(encounterSearch);
						if (programStage) {
							let patientSearch;
							if (subject && subject.identifier) {
								patientSearch = await ctx.call("es.searchByValues", {
									term: "attributes",
									values: [subject.identifier.value],
									index: "patients",
								});
							} else if (subject && subject.reference) {
								const [resourceType, id] = String(subject.reference).split("/");
								patientSearch = await ctx.call("es.searchById", {
									index: "patients",
									id,
								});
							}
							if (patientSearch) {
								const { enrollments, trackedEntityInstance, encounters } =
									patientSearch;
								let organisationSearch;
								if (
									serviceProvider.identifier &&
									serviceProvider.identifier.value &&
									serviceProvider.identifier.system
								) {
									organisationSearch = await ctx.call(
										"es.searchBySystemAndCode",
										{
											system: serviceProvider.identifier.system,
											value: serviceProvider.identifier.value,
											index: "organisations",
										}
									);
								} else if (
									serviceProvider.identifier &&
									serviceProvider.identifier.value
								) {
									const search = await ctx.call("es.searchById", {
										index: "organisations",
										id: serviceProvider.identifier.value,
									});
									organisationSearch = !!search ? search.mappings : [];
								} else if (serviceProvider.reference) {
									const search = await ctx.call("es.searchById", {
										index: "organisations",
										id: String(reference).replace("Organization/", ""),
									});
									organisationSearch = !!search ? search.mappings : [];
								}
								const orgUnit = this.getDHIS2Code(organisationSearch);
								if (orgUnit) {
									if (episodeOfCare) {
										const previousEnrollment = enrollments.find((e) => {
											return (
												e.id ===
												String(serviceProvider.reference).replace(
													"EpisodeOfCare/",
													""
												)
											);
										});
										if (previousEnrollment) {
											const { program, enrollment } = previousEnrollment;
											const previousEncounter = encounters.find((e) => {
												return (e.eventDate =
													start &&
													e.program === program &&
													e.orgUnit === orgUnit &&
													e.id === id);
											});
											if (!previousEncounter) {
												const event = generateUid();
												const encounter = {
													event,
													trackedEntityInstance,
													orgUnit,
													eventDate: start,
													program,
													programStage,
													enrollment,
												};
												const response = await ctx.call("dhis2.post", {
													url: "events",
													...encounter,
													dataValues: [],
												});
												await ctx.call("es.bulk", {
													index: "patients",
													dataset: [
														{
															...patientSearch,
															encounters: [...encounters, { ...encounter, id }],
														},
													],
													id: "trackedEntityInstance",
												});
												return response;
											}
											return { message: "Duplicate encounter" };
										}
										return {
											message: `No enrollment with was found`,
										};
									} else {
										return {
											message: `No episode of care with was found for given enrollment`,
										};
									}
								}
								return {
									message: `Organisation/Service provider with identifier was not found`,
								};
							}
						}
						return {
							message: `No encounter mapping to DHIS2 with ${code} was found`,
						};
					}
					return { message: `No encounter of type with  ${code} was found` };
				} catch (error) {
					return error;
				}
			},
		},
		Observation: {
			async handler(ctx) {
				try {
					const {
						Observation: {
							subject: {
								identifier: { value },
							},
							encounter: { reference },
							code: {
								coding: [{ system, code }],
							},
							valueQuantity,
							valueCodeableConcept,
							valueString,
							valueBoolean,
							valueInteger,
							valueTime,
							valueDateTime,
						},
					} = ctx.params;

					let realValue =
						valueString ||
						valueBoolean ||
						valueInteger ||
						valueTime ||
						valueDateTime;
					if (valueQuantity) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept) {
						const {
							coding: [{ code: val }],
						} = valueCodeableConcept;
						realValue = val;
					}
					if (realValue) {
						const concept = await ctx.call("es.searchBySystemAndCode", {
							system,
							value: code,
							index: "concepts",
						});
						const dataElement = this.getDHIS2Code(concept);
						if (dataElement) {
							const patientSearch = await ctx.call("es.searchByValues", {
								term: "attributes",
								values: [value],
								index: "patients",
							});
							if (patientSearch) {
								const { encounters } = patientSearch;
								const previousEncounter = encounters.find((e) => {
									return e.id === String(reference).replace("Encounter/", "");
								});
								if (previousEncounter) {
									const { id, event, ...others } = previousEncounter;
									return await ctx.call("dhis2.put", {
										url: `events/${event}/${dataElement}`,
										...others,
										event,
										dataValues: [{ dataElement, value: realValue }],
									});
								}
							}
						}
					}
				} catch (error) {
					return error;
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
		searchOneByOneAttribute(attributes, field, attribute, value) {
			const response = attributes.find(({ _source }) => {
				return (
					_source[field].find((mapping) => mapping[attribute] === value) !==
					undefined
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

		searchAttribute(attributes, type, value) {
			const attribute = attributes.find(({ _source }) => {
				return _source[type] === value;
			});
			if (attribute) {
				return this.getDHIS2Code(attribute._source.mappings);
			}
		},
		getReference(ref) {
			if (ref && ref.identifier && ref.identifier.value) {
				return ref.identifier.value;
			}
		},
		getObsValue(value) {},
		async getOrganisation(managingOrganization) {
			const organisation = this.getReference(managingOrganization);
			if (organisation) {
				const { system, value } = organisation;
			}
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
