package com.j24.mock.common;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(ApiException e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", e.code());
        body.put("message", e.getMessage());
        body.putAll(e.details());
        return ResponseEntity.status(e.status()).body(body);
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<Map<String, Object>> handleBadInput(Exception e) {
        String message = e instanceof MethodArgumentNotValidException invalid
                ? invalid.getBindingResult().getFieldErrors().stream()
                        .map(error -> error.getField() + " " + error.getDefaultMessage())
                        .reduce((a, b) -> a + "; " + b)
                        .orElse("invalid request")
                : "request body is missing or malformed";
        return handleApi(new ApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoRoute(NoResourceFoundException e) {
        return handleApi(new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND",
                "no API at /" + e.getResourcePath() + " (the UI runs on http://localhost:5180)"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(Exception e) {
        log.error("Unexpected error", e);
        return handleApi(new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "something went wrong"));
    }
}
