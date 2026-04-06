package com.tutien.pixel.entities;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "worlds")
public class worldEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String tenMap;
    @Column(unique = true)
    private String code;
    private String jsonMap;
    private int w;
    private int h;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTenMap() {
        return tenMap;
    }

    public void setTenMap(String tenMap) {
        this.tenMap = tenMap;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getJsonMap() {
        return jsonMap;
    }

    public void setJsonMap(String jsonMap) {
        this.jsonMap = jsonMap;
    }

    public int getW() {
        return w;
    }

    public void setW(int w) {
        this.w = w;
    }

    public int getH() {
        return h;
    }

    public void setH(int h) {
        this.h = h;
    }
}
