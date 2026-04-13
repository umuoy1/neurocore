import time


def expo(*args, **kwargs):
    return None


def on_exception(wait_gen, exception_types, max_tries=5, base_delay=2.0):
    def decorator(fn):
        def wrapped(*fn_args, **fn_kwargs):
            last_error = None
            for attempt in range(1, max_tries + 1):
                try:
                    return fn(*fn_args, **fn_kwargs)
                except exception_types as err:
                    last_error = err
                    if attempt >= max_tries:
                        raise
                    time.sleep(min(base_delay * (2 ** (attempt - 1)), 30.0))
            raise last_error
        return wrapped
    return decorator
