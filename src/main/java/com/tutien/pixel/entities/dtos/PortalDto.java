package com.tutien.pixel.entities.dtos;

import jakarta.persistence.Column;

public class PortalDto {
    private int id;
    private String denMap;
    private String code;
    private int x;
    private int y;
    private int toX;
    private int toY;
    private String mapCode;

    public PortalDto(int id, String denMap, String code, int x, int y, int toX, int toY, String mapCode) {
        this.id = id;
        this.denMap = denMap;
        this.code = code;
        this.x = x;
        this.y = y;
        this.toX = toX;
        this.toY = toY;
        this.mapCode = mapCode;
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getDenMap() {
        return denMap;
    }

    public void setDenMap(String denMap) {
        this.denMap = denMap;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public int getX() {
        return x;
    }

    public void setX(int x) {
        this.x = x;
    }

    public int getY() {
        return y;
    }

    public void setY(int y) {
        this.y = y;
    }

    public int getToX() {
        return toX;
    }

    public void setToX(int toX) {
        this.toX = toX;
    }

    public int getToY() {
        return toY;
    }

    public void setToY(int toY) {
        this.toY = toY;
    }

    public String getMapCode() {
        return mapCode;
    }

    public void setMapCode(String mapCode) {
        this.mapCode = mapCode;
    }
}
