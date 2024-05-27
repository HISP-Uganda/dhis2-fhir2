"use strict";
const { isEmpty } = require("lodash");
const { generateUid } = require("./uid");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "resources",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2", "search"],

	/**
	 * Actions
	 */
	actions: {
		Patient: {
			async handler(ctx) {
				const { Patient: patient } = ctx.params;
				try {
					const trackedEntityType = await ctx.call("search.entity");
					if (trackedEntityType) {
						const orgUnit = await ctx.call(
							"search.facility",
							patient.managingOrganization
						);
						if (orgUnit) {
							const { identifiers, biodata } = await ctx.call(
								"search.patient",
								patient
							);
							const identifierValues = identifiers.map((i) => i.value);
							if ([...identifierValues, ...biodata].length > 0 || patient.id) {
								let trackedEntityInstance = {
									trackedEntityType,
									orgUnit,
									attributes: [...identifiers, ...biodata],
								};
								let toBeIndexed = {
									attributes: identifierValues,
								};
								if (patient.id) {
									toBeIndexed = { ...toBeIndexed, patientId: patient.id };
								}
								const previousPatient = await ctx.call(
									"search.previousPatient",
									{
										patientId: patient.id,
										identifiers: identifierValues,
									}
								);
								if (previousPatient) {
									toBeIndexed = {
										...previousPatient,
										attributes: identifierValues,
									};
									if (patient.id) {
										toBeIndexed = {
											...previousPatient,
											attributes: identifierValues,
											patientId: patient.id,
										};
									}
									trackedEntityInstance = {
										...trackedEntityInstance,
										trackedEntityInstance:
											previousPatient.trackedEntityInstance,
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
										id: code,
										patientId: patient.id,
									};
								}
								const response = await ctx.call("dhis2.post", {
									url: "trackedEntityInstances",
									...trackedEntityInstance,
								});
								await ctx.call("es.bulk", {
									index: "patients",
									dataset: [toBeIndexed],
								});
								return response;
							}
						}
					}
				} catch (error) {
					return error;
				}
			},
		},
		EpisodeOfCare: {
			async handler(ctx) {
				const {
					EpisodeOfCare: {
						id,
						type: [
							{
								coding: [{ system, code, display }],
							},
						],
						period: { start },
						patient: { identifier, reference },
						managingOrganization,
					},
				} = ctx.params;

				let patient = {
					identifier: [],
				};
				if (reference) {
					patient = {
						...patient,
						patientId: String(reference).replace("Patient/", ""),
					};
				}

				if (identifier) {
					patient = {
						...patient,
						identifiers: identifier.map((id) => id.value),
					};
				}

				const program = await ctx.call("search.program", {
					system: system || display,
					code,
				});

				const orgUnit = await ctx.call("search.facility", managingOrganization);

				if (program !== null && orgUnit !== null) {
					const previousPatient = await ctx.call(
						"search.previousPatient",
						patient
					);
					if (previousPatient !== null && previousPatient !== undefined) {
						const { trackedEntityInstance } = previousPatient;
						const previousEnrollment = await ctx.call("search.previousEOC", {
							trackedEntityInstance,
							orgUnit,
							program,
							enrollmentDate: start,
						});
						if (isEmpty(previousEnrollment)) {
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
								index: "enrollments",
								dataset: [
									{
										...enroll,
										id: enrollment,
										eocId: id,
									},
								],
							});
							return response;
						} else {
							return { message: "Already enrolled" };
						}
					}
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
							subject: { reference, identifier },
							serviceProvider,
							episodeOfCare,
						},
					} = ctx.params;

					const programStage = await ctx.call("search.stage", { system, code });
					const orgUnit = await ctx.call("search.facility", serviceProvider);

					if (programStage && orgUnit) {
						let patient = {
							identifier: [],
						};
						if (reference) {
							patient = {
								...patient,
								patientId: String(reference).replace("Patient/", ""),
							};
						}
						if (identifier) {
							patient = {
								...patient,
								identifiers: identifier.map((id) => id.value),
							};
						}
						const previousPatient = await ctx.call(
							"search.previousPatient",
							patient
						);
						if (previousPatient) {
							const { trackedEntityInstance } = previousPatient;
							const previousEnrollment = await ctx.call("search.findEOC", {
								id: String(episodeOfCare.reference).replace(
									"EpisodeOfCare/",
									""
								),
								trackedEntityInstance,
								orgUnit,
							});

							if (previousEnrollment && programStage !== null) {
								const { program, enrollment } = previousEnrollment;
								const previousEncounter = await ctx.call(
									"search.previousEncounter",
									{
										id,
										trackedEntityInstance,
										orgUnit,
										eventDate: start,
										programStage,
										enrollment,
										program,
									}
								);
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
										index: "encounters",
										dataset: [{ ...encounter, encounterId: id, id: event }],
									});
									return response;
								}
								return "Already inserted";
							}
						}
					}
					return "No record was inserted some information is missing";
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
							subject: { identifier, reference },
							encounter,
							code: { coding },
							valueQuantity,
							valueCodeableConcept,
							valueString,
							valueBoolean,
							valueInteger,
							valueTime,
							valueDateTime,
							...rest
						},
					} = ctx.params;
					let realValue = valueString || valueInteger || valueTime;
					if (valueDateTime !== undefined) {
						realValue = String(valueDateTime).slice(0, 10);
					}
					if (valueBoolean !== undefined) {
						realValue = valueBoolean ? "Yes" : "No";
					}
					if (valueQuantity !== undefined) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept !== undefined) {
						const valueCode = valueCodeableConcept.coding.find(
							(code) => !!code.system
						);
						if (valueCode) {
							const searchCodeableConcept = await ctx.call("search.option", {
								system: valueCode.system,
								code: valueCode.code,
							});
							if (searchCodeableConcept) {
								realValue = searchCodeableConcept;
							} else {
								realValue = valueCode.code;
							}
						}
					}
					const foundMapping = coding.find(
						(code) => !!code.system && !!code.code
					);
					if (realValue) {
						if (foundMapping) {
							const { system, code } = foundMapping;
							const dataElement = await ctx.call("search.concept", {
								system,
								code,
							});

							let patient = {
								identifier: [],
							};
							if (reference) {
								patient = {
									...patient,
									patientId: String(reference).replace("Patient/", ""),
								};
							}
							if (identifier) {
								patient = {
									...patient,
									identifiers: identifier.map((id) => id.value),
								};
							}
							if (dataElement) {
								const previousPatient = await ctx.call(
									"search.previousPatient",
									patient
								);
								if (previousPatient) {
									const { trackedEntityInstance, orgUnit } = previousPatient;
									const previousEncounter = await ctx.call(
										"search.findEncounter",
										{
											id: String(encounter.reference).replace("Encounter/", ""),
											trackedEntityInstance,
											orgUnit,
										}
									);
									if (previousEncounter) {
										const {
											event,
											orgUnit,
											program,
											programStage,
											trackedEntityInstance,
										} = previousEncounter;
										// return {
										// 	event,
										// 	orgUnit,
										// 	program,
										// 	programStage,
										// 	trackedEntityInstance,
										// 	status: "ACTIVE",
										// 	dataValues: [{ dataElement, value: realValue }],
										// };
										return await ctx.call("dhis2.put", {
											url: `events/${event}/${dataElement}`,
											event,
											orgUnit,
											program,
											programStage,
											trackedEntityInstance,
											status: "ACTIVE",
											dataValues: [{ dataElement, value: realValue }],
										});
									} else {
										return `Could not find encounter ${String(
											encounter.reference
										).replace("Encounter/", "")}`;
									}
								} else {
									return `Could not find patient ${String(
										subject.reference
									).replace("Patient/", "")}`;
								}
							} else {
								// return `Could not find mapping for ${code}`;
							}
						} else {
							return `Could not find mapping system and code`;
						}
					} else {
						return "No value found for specified observation";
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
	methods: {},

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
