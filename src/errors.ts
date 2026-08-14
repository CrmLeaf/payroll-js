/**
 * The error surface, mirroring `Crmleaf\Payroll\Exceptions`.
 *
 * The distinction the PHP package draws is worth keeping: a caller error and a
 * statutory ineligibility are different things. Three years of service is not an
 * error - it is a valid result of nil gratuity with an explanation. A negative
 * salary is a bug in the calling code.
 */
export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidInputError extends PayrollError {
  static negative(field: string): InvalidInputError {
    return new InvalidInputError(`${field} cannot be negative.`);
  }

  static outOfRange(field: string, expected: string, actual: unknown): InvalidInputError {
    const shown =
      actual === null || actual === undefined || typeof actual === 'object'
        ? typeof actual
        : String(actual);

    return new InvalidInputError(`${field} must be ${expected}, got ${shown}.`);
  }

  static unknownOption(field: string, value: string, allowed: readonly string[]): InvalidInputError {
    return new InvalidInputError(`Unknown ${field} "${value}". Allowed: ${allowed.join(', ')}.`);
  }

  static unsupportedState(state: string): InvalidInputError {
    return new InvalidInputError(
      `"${state}" is not in the professional tax schedule. If the state levies professional tax and is ` +
        'missing, please open a rate-change issue; if it levies none, call statesWithoutProfessionalTax() first.',
    );
  }
}

export class InvalidMoneyError extends PayrollError {
  static notNumeric(value: string): InvalidMoneyError {
    return new InvalidMoneyError(`Cannot build Money from "${value}": the value is not numeric.`);
  }

  static notFinite(): InvalidMoneyError {
    return new InvalidMoneyError('Cannot build Money from NAN or INF.');
  }

  static divisionByZero(): InvalidMoneyError {
    return new InvalidMoneyError('Cannot divide a Money amount by zero.');
  }
}

export class RateNotFoundError extends PayrollError {
  static missingTable(key: string): RateNotFoundError {
    return new RateNotFoundError(`No rate table "${key}".`);
  }

  static noVersionForDate(key: string, date: string): RateNotFoundError {
    return new RateNotFoundError(
      `Rate table "${key}" has no version in force on ${date}. The tables only go back so far; ` +
        'if you need an earlier period, add a dated version rather than reusing a later one.',
    );
  }

  static missingPath(key: string, path: string): RateNotFoundError {
    return new RateNotFoundError(`Rate table "${key}" has no value at "${path}".`);
  }

  static notMonetary(key: string, path: string, actual: string): RateNotFoundError {
    return new RateNotFoundError(
      `Expected "${path}" in rate table "${key}" to be a monetary value in paise, got ${actual}.`,
    );
  }

  static notNumeric(key: string, path: string, actual: string): RateNotFoundError {
    return new RateNotFoundError(`Expected "${path}" in rate table "${key}" to be numeric, got ${actual}.`);
  }

  static notArray(key: string, path: string, actual: string): RateNotFoundError {
    return new RateNotFoundError(`Expected "${path}" in rate table "${key}" to be an array, got ${actual}.`);
  }

  static badFinancialYear(value: string): RateNotFoundError {
    return new RateNotFoundError(`"${value}" is not a financial year. Expected a label like "2025-26".`);
  }
}
