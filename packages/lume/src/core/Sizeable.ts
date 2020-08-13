import {Mixin, Constructor} from 'lowclass'
import {Eventful, emits} from '@lume/eventful'
import {reactive, attribute} from '@lume/element'
import TreeNode from './TreeNode'
import XYZSizeModeValues from './XYZSizeModeValues'
import XYZNonNegativeValues from './XYZNonNegativeValues'
import Motor from './Motor'

import type {MixinResult} from 'lowclass'
import type {StopFunction} from '@lume/element'
import type {XYZValuesObject, XYZValuesArray, XYZPartialValuesArray, XYZPartialValuesObject} from './XYZValues'
import type {SizeModeValue} from './XYZSizeModeValues'
import type {RenderTask} from './Motor'

// Property functions are used for animating properties of type XYZNumberValues or XYZNonNegativeValues
type XYZPropertyFunction = (
	x: number,
	y: number,
	z: number,
	time: number,
) => XYZValuesObject<number> | XYZValuesArray<number> | false

type SinglePropertyFunction = (value: number, time: number) => number | false

// working variables (used synchronously only, to avoid making new variables in
// repeatedly-called methods)
let propFunctionTask: RenderTask | undefined | null
const previousSize: Partial<XYZValuesObject<number>> = {}

function SizeableMixin<T extends Constructor>(Base: T) {
	const _Base = Constructor(Base) // this needs to be in a new variable due to https://github.com/microsoft/TypeScript/issues/35339
	const Parent = Eventful.mixin(TreeNode.mixin(_Base))

	// Sizeable extends TreeNode because Sizeable knows about its `parent` when
	// calculating proportional sizes. Also Transformable knows about it's parent
	// in order to calculate it's world matrix based on it's parent's.
	class Sizeable extends Parent {
		// TODO handle ctor arg types
		constructor(...args: any[]) {
			super(...args)

			this.sizeMode.on('valuechanged', () => (this.sizeMode = this.sizeMode))
			this.size.on('valuechanged', () => (this.size = this.size))
		}

		private __sizeMode = new XYZSizeModeValues('literal', 'literal', 'literal')

		/**
		 * Set the size mode for each axis. Possible size modes are "literal"
		 * and "proportional". The default values are "literal" for all axes.
		 */
		@reactive
		@attribute
		@emits('propertychange')
		set sizeMode(newValue) {
			if (typeof newValue === 'function') throw new TypeError('property functions are not allowed for sizeMode')
			this._setPropertyXYZ('sizeMode', newValue)
		}
		get sizeMode() {
			return this.__sizeMode
		}

		// TODO: A "differential" size would be cool. Good for padding,
		// borders, etc. Inspired from Famous' differential sizing.
		//
		// TODO: A "target" size where sizing can be relative to another node.
		// This would be tricky though, because there could be circular size
		// dependencies. Maybe we'd throw an error in that case, because there'd be no original size to base off of.

		private __size = new XYZNonNegativeValues(0, 0, 0)

		/**
		 * Set the size of each axis. The size for each axis depends on the
		 * sizeMode for each axis. For example, if node.sizeMode is set to
		 * `sizeMode = ['literal', 'proportional', 'literal']`, then setting
		 * `size = [20, 0.5, 30]` means that X size is a literal value of 20,
		 * Y size is 0.5 of it's parent Y size, and Z size is a literal value
		 * of 30. It is easy this way to mix literal and proportional sizes for
		 * the different axes.
		 *
		 * Literal sizes can be any value (the literal size that you want) and
		 * proportional sizes are a number between 0 and 1 representing a
		 * proportion of the parent node size. 0 means 0% of the parent size,
		 * and 1.0 means 100% of the parent size.
		 *
		 * All size values must be positive numbers.
		 *
		 * @param {Object} newValue
		 * @param {number} [newValue.x] The x-axis size to apply.
		 * @param {number} [newValue.y] The y-axis size to apply.
		 * @param {number} [newValue.z] The z-axis size to apply.
		 */
		@reactive
		@attribute
		@emits('propertychange')
		set size(newValue) {
			this._setPropertyXYZ('size', newValue)
		}
		get size() {
			return this.__size
		}

		/**
		 * Get the actual size of the Node. This can be useful when size is
		 * proportional, as the actual size of the Node depends on the size of
		 * it's parent.
		 *
		 * @readonly
		 *
		 * @return {Array.number} An Oject with x, y, and z properties, each
		 * property representing the computed size of the x, y, and z axes
		 * respectively.
		 *
		 * @reactive
		 */
		get calculatedSize() {
			// TODO we can re-calculate the actual size lazily, this way it can
			// normally be deferred to a Motor render task, unless a user
			// explicitly needs it and reads the value.
			// if (this.__sizeDirty) this._calcSize

			// TODO make __calculatedSize properties readonly and don't clone it
			// each time.
			return {...this.__calculatedSize}
		}

		/**
		 * Subclasses should push stop functions returned by autorun() into this
		 * array in connectedCallback, then disconnectedCallback will
		 * automatically clean them up.
		 */
		// XXX Perhaps move this to a separate mixin, as it isn't really related to sizing.
		protected _stopFns: Array<StopFunction> = []

		connectedCallback() {
			// TODO remove ts-ignore when we figure how to make this work in a
			// non-DOM env. It doesn't recognize the method existing, we
			// probably need to define it in TreeNode.
			// @ts-ignore
			super.connectedCallback()

			// For example, subclasses should push autoruns in connectedCallback.
			this._stopFns.push(/* autorun(...) */)
		}

		disconnectedCallback() {
			// TODO remove ts-ignore when we figure how to make this work in a
			// non-DOM env. It doesn't recognize the method existing, we
			// probably need to define it in TreeNode.
			// @ts-ignore
			super.disconnectedCallback()

			for (const stop of this._stopFns) stop()
		}

		// TODO, refactor, this is from DeclarativeBase, but doesn't make sense in TypeScript inheritance
		hasHtmlApi?: boolean
		protected _composedParent?: Sizeable
		protected _composedChildren?: Sizeable

		protected get _renderParent(): Sizeable {
			if (this.hasHtmlApi) {
				return this._composedParent as Sizeable
			} else {
				return this.parent as Sizeable
			}
		}

		protected get _renderChildren() {
			if (this.hasHtmlApi) {
				return this._composedChildren
			} else {
				return this.subnodes
			}
		}

		protected _getParentSize() {
			const parent = this._renderParent
			return parent ? parent.__calculatedSize : {x: 0, y: 0, z: 0}
		}

		protected _calcSize() {
			const calculatedSize = this.__calculatedSize
			Object.assign(previousSize, calculatedSize)
			const {__sizeMode: sizeMode, __size: size} = this
			const parentSize = this._getParentSize()

			if (sizeMode.x == 'literal') {
				calculatedSize.x = size.x
			} else {
				// proportional
				calculatedSize.x = parentSize.x * size.x
			}

			if (sizeMode.y == 'literal') {
				calculatedSize.y = size.y
			} else {
				// proportional
				calculatedSize.y = parentSize.y * size.y
			}

			if (sizeMode.z == 'literal') {
				calculatedSize.z = size.z
			} else {
				// proportional
				calculatedSize.z = parentSize.z * size.z
			}

			// trigger reactive updates (although we set it to the same value)
			this.__calculatedSize = calculatedSize

			if (
				previousSize.x !== calculatedSize.x ||
				previousSize.y !== calculatedSize.y ||
				previousSize.z !== calculatedSize.z
			) {
				this.emit('sizechange', {...calculatedSize})
			}
		}

		protected _setPropertyXYZ<K extends keyof this>(name: K, newValue: this[K]) {
			if (newValue === (this as any)['__' + name]) return
			if (isXYZPropertyFunction(newValue)) {
				this.__handleXYZPropertyFunction(newValue, name)
			} else {
				if (!this.__settingValueFromPropFunction) this.__removePropertyFunction(name)
				else this.__settingValueFromPropFunction = false
				;(this as any)['__' + name].from(newValue)
			}
		}

		protected _setPropertySingle<K extends keyof this>(name: K, newValue: this[K]) {
			if (isSinglePropertyFunction(newValue)) {
				this.__handleSinglePropertyFunction(newValue, name)
			} else {
				if (!this.__settingValueFromPropFunction) this.__removePropertyFunction(name)
				else this.__settingValueFromPropFunction = false
				;(this as any)['__' + name] = newValue
			}
		}

		@reactive private __calculatedSize: XYZValuesObject<number> = {x: 0, y: 0, z: 0}
		private __propertyFunctions: Map<string, RenderTask> | null = null
		private __settingValueFromPropFunction = false

		private __handleXYZPropertyFunction(fn: XYZPropertyFunction, name: keyof this) {
			if (!this.__propertyFunctions) this.__propertyFunctions = new Map()

			if ((propFunctionTask = this.__propertyFunctions.get(name as string))) {
				Motor.removeRenderTask(propFunctionTask)
				propFunctionTask = null
			}

			this.__propertyFunctions.set(
				name as string,
				Motor.addRenderTask(time => {
					const result = fn(
						(this as any)['__' + name].x,
						(this as any)['__' + name].y,
						(this as any)['__' + name].z,
						time,
					)

					if (result === false) {
						this.__propertyFunctions!.delete(name as string)
						return false
					}

					// mark this true, so that the following set of this[name]
					// doesn't override the prop function (normally a
					// user can set this[name] to a value that isn't a function
					// to disable the prop function).
					this.__settingValueFromPropFunction = true
					;(this as any)[name] = result
				}),
			)
		}

		private __handleSinglePropertyFunction(fn: SinglePropertyFunction, name: keyof this) {
			if (!this.__propertyFunctions) this.__propertyFunctions = new Map()

			if ((propFunctionTask = this.__propertyFunctions.get(name as string))) {
				Motor.removeRenderTask(propFunctionTask)
				propFunctionTask = null
			}

			this.__propertyFunctions.set(
				name as string,
				Motor.addRenderTask(time => {
					const result = fn((this as any)['__' + name], time)

					if (result === false) {
						this.__propertyFunctions!.delete(name as string)
						return false
					}

					this.__settingValueFromPropFunction = true
					;(this as any)[name] = result
				}),
			)
		}

		// remove property function (render task) if any.
		private __removePropertyFunction(name: keyof this) {
			if (this.__propertyFunctions && (propFunctionTask = this.__propertyFunctions.get(name as string))) {
				Motor.removeRenderTask(propFunctionTask)
				this.__propertyFunctions.delete(name as string)
				if (!this.__propertyFunctions.size) this.__propertyFunctions = null
				propFunctionTask = null
			}
		}
	}

	return Sizeable as MixinResult<typeof Sizeable, T>
}

// the following type guards are used above just to satisfy the type system,
// though the actual runtime check does not guarantee that the functions are of
// the expected shape.

function isXYZPropertyFunction(f: any): f is XYZPropertyFunction {
	return typeof f === 'function'
}

function isSinglePropertyFunction(f: any): f is SinglePropertyFunction {
	return typeof f === 'function'
}

export const Sizeable = Mixin(SizeableMixin)
export interface Sizeable extends InstanceType<typeof Sizeable> {}
export default Sizeable

export type Size = XYZNonNegativeValues | XYZPartialValuesArray<number> | XYZPartialValuesObject<number> | string
export type SizeMode =
	| XYZSizeModeValues
	| XYZPartialValuesArray<SizeModeValue>
	| XYZPartialValuesObject<SizeModeValue>
	| string

export function size(val: Size) {
	return val as XYZNonNegativeValues
}

export function sizeMode(val: SizeMode) {
	return val as XYZSizeModeValues
}
